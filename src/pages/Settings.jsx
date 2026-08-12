import { useState, useEffect } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { usePrefs, setPrefs, getPrefs } from '../lib/prefs.js';
import { overflowFor, navFor, NAV } from '../components/Layout.jsx';
import { useResource, PageHeader, Field, money, Modal, Loading, useIsMobile } from '../components/ui.jsx';
import { PAGES, CAP_LABEL } from '../../lib/permissions.js';

// Collapsible settings section. Condensed by default on mobile so the long
// Settings page is scannable; expand (▾) / collapse (▴) toggles the body.
function Collapsible({ title, subtitle, children, defaultOpen }) {
  const isMobile = useIsMobile();
  // Remember each section's open/closed state per browser, so a section the user
  // collapsed stays collapsed next time. Falls back to the default when unset.
  const saved = getPrefs().settingsCollapsed?.[title];
  const [open, setOpen] = useState(saved != null ? !saved : (defaultOpen ?? !isMobile));
  const toggle = () => setOpen((o) => {
    const next = !o;
    setPrefs({ settingsCollapsed: { ...(getPrefs().settingsCollapsed || {}), [title]: !next } });
    return next;
  });
  return (
    <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', padding: '14px 18px', color: 'var(--text)', textAlign: 'left' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          {subtitle && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      <div style={{ display: open ? 'block' : 'none', padding: '0 18px 18px' }}>{children}</div>
    </div>
  );
}

// --- Role Editor: workspace admins define custom roles (page / sub-feature /
// view-edit). Built-in presets are shown read-only. ---
function RolesCard() {
  const [roles, setRoles] = useState(null);
  const [regions, setRegions] = useState([]);
  const [draft, setDraft] = useState(null); // { key?, name, preset?, default_region_id, permissions:{pages,caps} }
  const [err, setErr] = useState(null);
  const load = () => api.get('/roles').then(setRoles).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get('/regions').then(setRegions).catch(() => {}); }, []);
  const regionName = (id) => regions.find((r) => r.id === id)?.name || '—';

  const startNew = () => setDraft({ name: '', preset: false, default_region_id: '', permissions: { pages: ['dashboard'], caps: [] } });
  const startEdit = (r) => setDraft({ key: r.key, name: r.name, preset: !!r.preset, default_region_id: r.default_region_id || '', permissions: { pages: [...r.permissions.pages], caps: [...r.permissions.caps] } });
  const toggle = (field, k) => setDraft((d) => {
    const arr = d.permissions[field];
    const next = arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k];
    return { ...d, permissions: { ...d.permissions, [field]: next } };
  });
  const save = async () => {
    try {
      if (!draft.name.trim()) { setErr('Role name is required'); return; }
      const dr = draft.default_region_id || null;
      if (draft.preset) await api.patch(`/roles/${draft.key}`, { name: draft.name, default_region_id: dr });
      else if (draft.key) await api.patch(`/roles/${draft.key}`, { name: draft.name, permissions: draft.permissions, default_region_id: dr });
      else await api.post('/roles', { name: draft.name, permissions: draft.permissions, default_region_id: dr });
      setDraft(null); setErr(null); load();
    } catch (e) { setErr(e.message); }
  };
  const del = async (r) => {
    if (!confirm(`Delete role "${r.name}"?`)) return;
    try { await api.del(`/roles/${r.key}`); load(); } catch (e) { setErr(e.message); }
  };

  const RegionField = () => regions.length > 0 && (
    <Field label="Default region for new users with this role">
      <select className="input" value={draft.default_region_id} onChange={(e) => setDraft({ ...draft, default_region_id: e.target.value })}>
        <option value="">— none —</option>
        {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </Field>
  );

  return (
    <Collapsible title="Roles &amp; permissions">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Define custom roles and rename built-in ones. Assign a default region so new users with that role are auto-placed. Built-in role permissions are fixed.</p>
      {err && <p className="badge badge-red" style={{ display: 'block' }}>{err}</p>}
      {!roles ? <Loading label="Loading roles…" /> : roles.map((r) => (
        <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)' }}>
          <div><span style={{ fontWeight: 600 }}>{r.name}</span> {r.preset ? <span className="badge">built-in</span> : null}
            <div className="muted" style={{ fontSize: 12 }}>{r.permissions.pages.length} pages · {r.permissions.caps.length} permissions{r.default_region_id ? ` · region: ${regionName(r.default_region_id)}` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ padding: '5px 10px' }} onClick={() => startEdit(r)}>Edit</button>
            {!r.preset && <button className="btn btn-danger" style={{ padding: '5px 10px' }} onClick={() => del(r)}>Delete</button>}
          </div>
        </div>
      ))}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={startNew}>New role</button>

      {draft && (
        <Modal title={draft.key ? `Edit role: ${draft.name}` : 'New role'} onClose={() => setDraft(null)}>
          <Field label="Role name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Front Desk" /></Field>
          <RegionField />
          {draft.preset ? (
            <p className="muted" style={{ fontSize: 12.5 }}>Built-in role — its page/permission set is fixed. You can rename it and set a default region.</p>
          ) : (
          <>
          <div className="label" style={{ marginBottom: 6 }}>Pages &amp; permissions</div>
          <div style={{ maxHeight: '48vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {PAGES.filter((p) => p.key !== 'dashboard').map((p) => {
              const viewable = draft.permissions.pages.includes(p.key);
              return (
                <div key={p.key} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                    <input type="checkbox" checked={viewable} onChange={() => toggle('pages', p.key)} /> {p.label}
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>can view</span>
                  </label>
                  {viewable && p.caps.length > 0 && (
                    <div style={{ paddingLeft: 26, marginTop: 6, display: 'grid', gap: 4 }}>
                      {p.caps.map((c) => (
                        <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input type="checkbox" checked={draft.permissions.caps.includes(c)} onChange={() => toggle('caps', c)} /> {CAP_LABEL[c] || c}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save role</button>
          </div>
        </Modal>
      )}
    </Collapsible>
  );
}

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

// Regions — manager-only. Group customers/work; a sortable dimension across the app.
function RegionsCard() {
  const [regions, setRegions] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const load = () => api.get('/regions').then(setRegions).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await api.post('/regions', { name: name.trim() }); setName(''); load(); } catch (ex) { setErr(ex.message); }
  };
  const rename = async (r) => {
    const next = prompt('Region name', r.name);
    if (next == null || !next.trim() || next.trim() === r.name) return;
    try { await api.patch(`/regions/${r.id}`, { name: next.trim() }); load(); } catch (ex) { setErr(ex.message); }
  };
  const del = async (r) => {
    if (!confirm(`Delete region "${r.name}"? Customers keep their data but lose this region tag.`)) return;
    try { await api.del(`/regions/${r.id}`); load(); } catch (ex) { setErr(ex.message); }
  };
  if (regions == null) return null;
  return (
    <Collapsible title="Regions">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Assign customers to a region and sort/filter by it across the app.</p>
      {err && <p className="badge badge-red">{err}</p>}
      {regions.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{r.name}</span>
          <button className="btn" style={{ padding: '4px 10px' }} onClick={() => rename(r)}>Rename</button>
          <button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => del(r)}>Delete</button>
        </div>
      ))}
      {!regions.length && <p className="muted">No regions yet.</p>}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input className="input" placeholder="New region name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" type="submit">Add region</button>
      </form>
    </Collapsible>
  );
}

// Per-user notification delivery toggles (bell). Visible to every member.
function NotificationsCard() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/notification-prefs').then(setData).catch(() => setData({ types: {}, prefs: {} })); }, []);
  const toggle = async (t) => {
    const prefs = { ...data.prefs, [t]: !data.prefs[t] };
    setData({ ...data, prefs });
    try { setData(await api.patch('/notification-prefs', { prefs: { [t]: prefs[t] } })); } catch { /* revert on failure */ api.get('/notification-prefs').then(setData).catch(() => {}); }
  };
  if (!data) return null;
  const entries = Object.entries(data.types || {});
  return (
    <Collapsible title="Notifications">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Choose what shows up in your bell.</p>
      {entries.length ? entries.map(([t, label]) => (
        <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!data.prefs[t]} onChange={() => toggle(t)} />
          <span>{label}</span>
        </label>
      )) : <p className="muted">Notification settings need a database update.</p>}
    </Collapsible>
  );
}

// Per-workspace Sage Intacct integration (manager-only). Secret fields show
// "saved" state and are only sent when changed; the browser never receives them.
function IntacctCard() {
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/integrations/intacct').then((d) => { setData(d); setVals({}); }).catch(() => setData({ available: false }));
  useEffect(() => { load(); }, []);
  if (!data || !data.available) return null;

  const fields = data.fields || {};
  const save = async (enabledOverride) => {
    setBusy(true); setNotice(null);
    try {
      const config = {};
      for (const [k, f] of Object.entries(fields)) {
        if (k in vals) config[k] = vals[k];              // changed non-secret or newly typed secret
        else if (!f.secret) config[k] = data.config[k];  // keep non-secret as shown
      }
      const body = { config };
      if (typeof enabledOverride === 'boolean') body.enabled = enabledOverride;
      const r = await api.patch('/integrations/intacct', body);
      setData((d) => ({ ...d, enabled: r.enabled, config: r.config })); setVals({});
      setNotice('Saved.');
    } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setNotice('Testing…');
    try { const r = await api.post('/integrations/intacct/test', {}); setNotice(r.ok ? `Connected to company ${r.company}.` : 'Connected.'); }
    catch (e) { setNotice(e.message); } finally { setBusy(false); }
  };

  return (
    <Collapsible title="Sage Intacct">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
        <input type="checkbox" checked={!!data.enabled} disabled={busy} onChange={(e) => save(e.target.checked)} /> Enabled
      </label>
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Connect your own Sage Intacct account. Credentials are encrypted at rest and never leave the server.</p>
      {!data.secretsConfigured && <p className="badge badge-amber" style={{ display: 'inline-block' }}>Server secret storage not configured (SECRETS_KEY) — saving secrets will fail.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {Object.entries(fields).map(([k, f]) => (
          <Field key={k} label={f.label}>
            <input className="input" type={f.secret ? 'password' : 'text'}
              placeholder={f.secret ? (data.config[k]?.saved ? '•••••••• (saved — leave blank to keep)' : 'not set') : ''}
              value={k in vals ? vals[k] : (f.secret ? '' : (data.config[k] || ''))}
              onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => save()}>Save credentials</button>
        <button className="btn" disabled={busy} onClick={test}>Test connection</button>
        {notice && <span className="muted" style={{ fontSize: 12.5 }}>{notice}</span>}
      </div>
    </Collapsible>
  );
}

export default function Settings() {
  const me = useMe();
  const canOrg = me.can('members:write');
  const canSvc = me.can('service:write');
  const [orgName, setOrgName] = useState(me.org?.name || '');
  const [notice, setNotice] = useState(null);
  const emailCfg = me.org?.feature_flags?.email || {};
  const [email, setEmail] = useState({ from: emailCfg.from || '', fromName: emailCfg.fromName || '', replyTo: emailCfg.replyTo || '' });
  const { rows: offers, create, update, remove } = useResource('/service-offers');
  const [svc, setSvc] = useState(BLANK_SVC);
  const prefs = usePrefs();
  const pinnable = overflowFor(me.pages || []);
  const pins = prefs.mobilePins || [];
  const togglePin = (to) => {
    const set = new Set(pins);
    set.has(to) ? set.delete(to) : set.add(to);
    setPrefs({ mobilePins: [...set] });
  };
  // Ordered nav lists for the reorder controls, honoring saved order then defaults.
  const roleNav = navFor(me.pages || []);
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

  const saveEmail = async (e) => {
    e.preventDefault();
    try { await api.patch('/org', { email }); setNotice('Email sender saved. Ticket replies will send from this address.'); }
    catch (ex) { setNotice(`Save failed: ${ex.message}`); }
  };

  const addSvc = async (e) => {
    e.preventDefault();
    await create({ ...svc, default_rate: svc.default_rate === '' ? null : Number(svc.default_rate) });
    setSvc(BLANK_SVC);
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
        <Collapsible title="Workspace" defaultOpen>
          <form onSubmit={saveName} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}><Field label="Workspace name"><input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field></div>
            <button className="btn btn-primary" type="submit" style={{ marginBottom: 14 }}>Save</button>
          </form>
          <div className="muted" style={{ fontSize: 12 }}>Workspace ID: <code>{me.org?.id}</code></div>
        </Collapsible>
      )}

      {canOrg && (
        <Collapsible title="Communication — outbound email">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Replies to customer tickets are emailed from this address. Use an address on your own domain (its sending domain must be verified with the platform’s email provider).</p>
          <form onSubmit={saveEmail}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="From address"><input className="input" type="email" placeholder="support@yourclinic.com" value={email.from} onChange={(e) => setEmail({ ...email, from: e.target.value })} /></Field>
              <Field label="From name"><input className="input" placeholder={me.org?.name || 'Your company'} value={email.fromName} onChange={(e) => setEmail({ ...email, fromName: e.target.value })} /></Field>
            </div>
            <Field label="Reply-to (optional)"><input className="input" type="email" value={email.replyTo} onChange={(e) => setEmail({ ...email, replyTo: e.target.value })} /></Field>
            <div style={{ textAlign: 'right' }}><button className="btn btn-primary" type="submit">Save email sender</button></div>
          </form>
        </Collapsible>
      )}

      <NotificationsCard />

      {me.can('regions:write') && <RegionsCard />}

      {canOrg && <IntacctCard />}

      <Collapsible title="Accessibility">
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
      </Collapsible>

      <Collapsible title="Navigation layout">
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
      </Collapsible>

      <Collapsible title="Mobile top navigation">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Pin symbols to the top bar on phones. Unpinned items live in the ☰ menu.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {pinnable.map(({ to, label, icon: Icon }) => (
            <label key={to} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={pins.includes(to)} onChange={() => togglePin(to)} />
              <Icon size={16} /> <span style={{ fontSize: 13 }}>{label}</span>
            </label>
          ))}
        </div>
      </Collapsible>

      {canSvc && (
      <Collapsible title="Service offers &amp; rates">
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
      </Collapsible>
      )}

      {me.can('roles:write') && <RolesCard />}

      {canOrg && (
        <Collapsible title="Data &amp; backup">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Download a full JSON backup of this workspace anytime — no lock-in.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportData}>Export all data (JSON)</button>
          </div>
        </Collapsible>
      )}
    </>
  );
}
