import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Modal, Loading, date } from '../../components/ui.jsx';

const PLANS = ['starter', 'pro', 'enterprise'];
const statusTone = (s) => (s === 'active' ? 'badge-green' : s === 'past_due' || s === 'canceled' ? 'badge-red' : '');

function NewWorkspace({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', id: '', plan: 'starter', first_admin_email: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const org = await api.post('/super/orgs', {
        name: f.name.trim(),
        id: f.id.trim() || undefined,
        plan: f.plan,
        first_admin_email: f.first_admin_email.trim() || undefined,
      });
      onCreated(org);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <Modal title="New workspace" onClose={onClose}>
      <form onSubmit={submit}>
        {err && <p className="badge badge-red" style={{ display: 'block', marginBottom: 10 }}>{err}</p>}
        <Field label="Business name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Riverside Dental Partners" /></Field>
        <Field label="Workspace id (URL slug) — optional, derived from name if blank"><input className="input" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="riverside-dental" /></Field>
        <Field label="Plan">
          <select className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="First admin email — optional (bootstraps as Manager Admin)"><input className="input" type="email" value={f.first_admin_email} onChange={(e) => setF({ ...f, first_admin_email: e.target.value })} placeholder="owner@business.com" /></Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Workspaces() {
  const [orgs, setOrgs] = useState(null);
  const [err, setErr] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const nav = useNavigate();

  const load = () => api.get('/super/orgs').then(setOrgs).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  // Open a workspace AS that workspace: set the view_as cookie server-side, then
  // land in its console at the bare /:orgSlug on the app origin.
  const openWorkspace = async (id) => {
    try { await api.post(`/super/view-as/${id}`, {}); window.location.assign(`/${id}`); }
    catch (e) { setErr(e.message); }
  };

  return (
    <>
      <PageHeader title="Workspaces" subtitle="Every client organization on the platform"
        action={<button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> New workspace</button>} />

      {err && <p className="badge badge-red">{err}</p>}
      {!orgs && !err && <Loading label="Loading workspaces…" />}

      {orgs && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data" style={{ width: '100%' }}>
            <thead><tr><th>Workspace</th><th>Plan</th><th>Subscription</th><th style={{ textAlign: 'right' }}>Members</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td style={{ cursor: 'pointer' }} onClick={() => nav(`/workspaces/${o.id}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 6, background: o.branding?.primaryColor || 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Building2 size={14} color="#fff" /></span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{o.branding?.displayName || o.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}><code>{o.id}</code></div>
                      </div>
                    </div>
                  </td>
                  <td><span className="badge badge-blue">{o.plan}</span></td>
                  <td>{o.subscription_status ? <span className={`badge ${statusTone(o.subscription_status)}`}>{o.subscription_status}</span> : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right' }}>{o.member_count ?? '—'}</td>
                  <td className="muted">{date(o.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-primary" style={{ padding: '5px 12px' }} onClick={(e) => { e.stopPropagation(); openWorkspace(o.id); }}>Open workspace</button>
                    <button className="btn" style={{ padding: '5px 10px', marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); nav(`/workspaces/${o.id}`); }}>Manage</button>
                  </td>
                </tr>
              ))}
              {!orgs.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No workspaces yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewWorkspace onClose={() => setShowNew(false)} onCreated={(o) => { setShowNew(false); nav(`/workspaces/${o.id}`); }} />}
    </>
  );
}
