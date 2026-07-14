import { useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Field, money } from '../components/ui.jsx';

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

      {canOrg && (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Data &amp; backup</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Download a full JSON backup of this workspace anytime — no lock-in.</p>
          <button className="btn" onClick={exportData}>Export all data (JSON)</button>
        </div>
      )}
    </>
  );
}
