import { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { usePrefs, setPrefs } from '../lib/prefs.js';
import { overflowFor, navFor, NAV } from '../components/Layout.jsx';
import { useResource, PageHeader, Field, money } from '../components/ui.jsx';

// Reorderable nav list. Up/down buttons work on touch (most users are mobile);
// drag-and-drop is the desktop convenience. dataTransfer.setData is required or
// some browsers never start the drag.
function ReorderList({ items, onReorder, mark }) {
  const [drag, setDrag] = useState(null);
  const move = (from, to) => { if (to < 0 || to >= items.length) return; const a = [...items]; const [x] = a.splice(from, 1); a.splice(to, 0, x); onReorder(a); };
  return (
    <div>
      {items.map((it, i) => (
        <div key={it.to} draggable
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
          onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }}
          onDragEnd={() => setDrag(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, background: drag === i ? 'var(--surface-2)' : 'var(--surface)' }}>
          <GripVertical size={14} className="muted" style={{ cursor: 'grab', flexShrink: 0 }} />
          <it.icon size={16} />
          <span style={{ fontSize: 13, flex: 1 }}>{it.label}</span>
          {mark && mark(it, i)}
          <button className="btn icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><ChevronUp size={15} /></button>
          <button className="btn icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, i + 1)}><ChevronDown size={15} /></button>
        </div>
      ))}
    </div>
  );
}

const UNITS = ['hour', 'visit', 'flat'];
const BLANK_SVC = { name: '', unit: 'hour', default_rate: '' };

export default function Settings() {
  const me = useMe();
  const canOrg = me.can('members:write');
  const canSvc = me.can('service:write');
  const [orgName, setOrgName] = useState(me.org?.name || '');
  const [notice, setNotice] = useState(null);
  const { rows: offers, create, update, remove } = useResource('/service-offers');
  const [svc, setSvc] = useState(BLANK_SVC);
  const prefs = usePrefs();
  const pinnable = overflowFor(me.viewer?.role);
  const pins = prefs.mobilePins || [];
  const togglePin = (to) => {
    const set = new Set(pins);
    set.has(to) ? set.delete(to) : set.add(to);
    setPrefs({ mobilePins: [...set] });
  };
  // Ordered nav lists for the reorder controls, honoring saved order then defaults.
  const roleNav = navFor(me.viewer?.role);
  const orderList = (saved, fallback) => {
    const arr = (saved || fallback.map((n) => n.to)).map((p) => roleNav.find((n) => n.to === p)).filter(Boolean);
    return [...arr, ...roleNav.filter((n) => !arr.includes(n))];
  };
  const desktopItems = orderList(prefs.desktopOrder, roleNav);
  const DEFAULT_BOTTOM = ['/', '/work-orders', '/schedule', '/customers', '/map'];
  const bottomItems = orderList(prefs.bottomNav, DEFAULT_BOTTOM.map((p) => ({ to: p })));

  const saveName = async (e) => {
    e.preventDefault();
    try { await api.patch('/org', { name: orgName }); setNotice('Workspace name saved. It updates across the app on next load.'); }
    catch (ex) { setNotice(`Save failed: ${ex.message}`); }
  };

  const addSvc = async (e) => {
    e.preventDefault();
    await create({ ...svc, default_rate: svc.default_rate === '' ? null : Number(svc.default_rate) });
    setSvc(BLANK_SVC);
  };

  const [seeding, setSeeding] = useState(false);
  const loadDemo = async () => {
    setSeeding(true);
    try {
      const r = await api.post('/demo-seed', {});
      if (r.seeded) {
        const n = Object.values(r.created).reduce((a, b) => a + b, 0);
        setNotice(`Loaded ${n} demo records (customers, work orders, assets, and more). Refresh a page to see them.`);
      } else {
        setNotice(r.reason || 'Workspace already has data — nothing added.');
      }
    } catch (ex) { setNotice(`Demo load failed: ${ex.message}`); }
    finally { setSeeding(false); }
  };

  const exportData = async () => {
    try {
      const data = await api.get('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `dispatch-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (ex) { setNotice(`Export failed: ${ex.message}`); }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace, service rates, and backups" />

      {notice && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, borderColor: 'var(--success)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{notice}</span><button className="btn" style={{ padding: '2px 8px' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {canOrg && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Workspace</h3>
          <form onSubmit={saveName} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}><Field label="Workspace name"><input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field></div>
            <button className="btn btn-primary" type="submit" style={{ marginBottom: 14 }}>Save</button>
          </form>
          <div className="muted" style={{ fontSize: 12 }}>Workspace ID: <code>{me.org?.id}</code></div>
        </div>
      )}

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Accessibility</h3>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!prefs.contrast} onChange={(e) => setPrefs({ contrast: e.target.checked })} /> High contrast
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Text size
            <select className="input" style={{ width: 'auto' }} value={prefs.textSize || 'normal'} onChange={(e) => setPrefs({ textSize: e.target.value })}>
              <option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Navigation layout</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <input type="checkbox" checked={!!prefs.logoRight} onChange={(e) => setPrefs({ logoRight: e.target.checked })} /> Logo on the right (desktop top bar)
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          <div>
            <div className="label">Desktop sidebar order — drag to reorder</div>
            <ReorderList items={desktopItems} onReorder={(a) => setPrefs({ desktopOrder: a.map((n) => n.to) })} />
          </div>
          <div>
            <div className="label">Mobile bottom bar — drag to reorder (first 5 show)</div>
            <ReorderList items={bottomItems} onReorder={(a) => setPrefs({ bottomNav: a.map((n) => n.to) })}
              mark={(_, i) => (i < 5 ? <span className="badge badge-green">on bar</span> : <span className="badge">hidden</span>)} />
          </div>
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setPrefs({ desktopOrder: null, bottomNav: null, mobilePins: [], logoRight: false })}>Reset navigation</button>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Mobile top navigation</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Pin symbols to the top bar on phones. Unpinned items live in the ☰ menu.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {pinnable.map(({ to, label, icon: Icon }) => (
            <label key={to} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={pins.includes(to)} onChange={() => togglePin(to)} />
              <Icon size={16} /> <span style={{ fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {canSvc && (
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Service offers &amp; rates</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Rates drive labor cost in project P&amp;L and timesheets.</p>
        {canSvc && (
          <form onSubmit={addSvc} style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Service name" required value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} style={{ flex: '1 1 180px' }} />
            <select className="input" value={svc.unit} onChange={(e) => setSvc({ ...svc, unit: e.target.value })} style={{ width: 110 }}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <input className="input" type="number" step="0.01" placeholder="Rate" value={svc.default_rate} onChange={(e) => setSvc({ ...svc, default_rate: e.target.value })} style={{ width: 110 }} />
            <button className="btn btn-primary" type="submit">Add</button>
          </form>
        )}
        {offers.map((o) => (
          <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)' }}>
            <div><div style={{ fontWeight: 600 }}>{o.name}</div><div className="muted" style={{ fontSize: 12 }}>per {o.unit}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {canSvc ? (
                <input className="input" type="number" step="0.01" defaultValue={o.default_rate ?? ''} style={{ width: 100 }}
                  onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== o.default_rate) update(o.id, { default_rate: v }); }} />
              ) : <b>{money(o.default_rate)}</b>}
              {canSvc && <button className="btn btn-danger" style={{ padding: '5px 10px' }} onClick={() => { if (confirm(`Delete "${o.name}"?`)) remove(o.id); }}>Delete</button>}
            </div>
          </div>
        ))}
        {!offers.length && <p className="muted">No service offers yet.</p>}
      </div>
      )}

      {canOrg && (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Data &amp; backup</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Download a full JSON backup of this workspace anytime — no lock-in.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportData}>Export all data (JSON)</button>
            <button className="btn" onClick={loadDemo} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo data'}</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>“Load demo data” adds sample customers, work orders, and assets to an empty workspace so you can explore the app. It won’t touch a workspace that already has customers.</p>
        </div>
      )}
    </>
  );
}
