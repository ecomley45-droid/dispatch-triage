import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, ExternalLink, Settings2, Smartphone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Modal, Loading, date, useIsMobile } from '../../components/ui.jsx';

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

function OrgIcon({ o }) {
  return (
    <span style={{ width: 36, height: 36, borderRadius: 8, background: o.branding?.primaryColor || 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Building2 size={16} color="#fff" />
    </span>
  );
}

export default function Workspaces() {
  const [orgs, setOrgs] = useState(null);
  const [err, setErr] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [opening, setOpening] = useState(null);
  // Which role "Open workspace" impersonates — lets a demo open straight into
  // a Dispatcher's or Technician's view instead of always landing as the top
  // admin, without needing the device simulator for a quick single-screen look.
  const [openRole, setOpenRole] = useState('manager_admin');
  const [roleOptions, setRoleOptions] = useState([{ key: 'manager_admin', name: 'Manager Admin' }]);
  const nav = useNavigate();
  const isMobile = useIsMobile();

  const load = () => api.get('/super/orgs').then(setOrgs).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const openWorkspace = async (id) => {
    setOpening(id);
    try { await api.post(`/super/view-as/${id}`, { role: openRole }); window.location.assign(`/${id}`); }
    catch (e) { setErr(e.message); setOpening(null); }
  };
  // Roles differ per workspace (custom roles + renamed presets), so refresh
  // the option list against whichever org's row the pointer is over.
  const loadRoles = (id) => api.get(`/super/orgs/${id}`).then((o) => setRoleOptions(o.roles || [])).catch(() => {});

  // Opens the in-app multi-device simulator with this workspace loaded live.
  // The Simulate page itself sets the view-as cookie on mount.
  const simulateWorkspace = (id) => nav(`/simulate/${id}`);

  return (
    <>
      <PageHeader title="Workspaces" subtitle="Every client organization on the platform"
        action={<button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> New workspace</button>} />

      {err && <p className="badge badge-red">{err}</p>}
      {!orgs && !err && <Loading label="Loading workspaces…" />}

      {orgs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label className="muted" style={{ fontSize: 12 }}>Open workspace as:</label>
          <select className="input" style={{ width: 'auto' }} value={openRole} onChange={(e) => setOpenRole(e.target.value)}>
            {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 11.5 }}>Hover a workspace to load its role list — lets you demo exactly what that role sees.</span>
        </div>
      )}

      {orgs && (isMobile ? (
        // Mobile: card list — each card is a large tap target with clear actions
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!orgs.length && <p className="muted" style={{ textAlign: 'center', padding: 32 }}>No workspaces yet.</p>}
          {orgs.map((o) => (
            <div key={o.id} className="card" style={{ padding: 14 }} onMouseEnter={() => loadRoles(o.id)} onFocus={() => loadRoles(o.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <OrgIcon o={o} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.branding?.displayName || o.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}><code>{o.id}</code></div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge badge-blue">{o.plan}</span>
                {o.subscription_status && <span className={`badge ${statusTone(o.subscription_status)}`}>{o.subscription_status}</span>}
                {o.member_count != null && <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{o.member_count} members</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 0' }}
                  disabled={opening === o.id}
                  onClick={() => openWorkspace(o.id)}
                >
                  <ExternalLink size={14} />{opening === o.id ? 'Opening…' : 'Open workspace'}
                </button>
                <button
                  className="btn"
                  style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => nav(`/workspaces/${o.id}`)}
                >
                  <Settings2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Desktop: full table
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data" style={{ width: '100%' }}>
            <thead><tr><th>Workspace</th><th>Plan</th><th>Subscription</th><th style={{ textAlign: 'right' }}>Members</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} onMouseEnter={() => loadRoles(o.id)}>
                  <td style={{ cursor: 'pointer' }} onClick={() => nav(`/workspaces/${o.id}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <OrgIcon o={o} />
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
                    <button className="btn btn-primary" style={{ padding: '5px 12px' }} disabled={opening === o.id} onClick={(e) => { e.stopPropagation(); openWorkspace(o.id); }}>{opening === o.id ? 'Opening…' : 'Open workspace'}</button>
                    <button className="btn" style={{ padding: '5px 10px', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={(e) => { e.stopPropagation(); simulateWorkspace(o.id); }}>
                      <Smartphone size={13} />Simulate
                    </button>
                    <button className="btn" style={{ padding: '5px 10px', marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); nav(`/workspaces/${o.id}`); }}>Manage</button>
                  </td>
                </tr>
              ))}
              {!orgs.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No workspaces yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ))}

      {showNew && <NewWorkspace onClose={() => setShowNew(false)} onCreated={(o) => { setShowNew(false); nav(`/workspaces/${o.id}`); }} />}
    </>
  );
}
