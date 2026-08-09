import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Loading, date } from '../../components/ui.jsx';
import { useSuperMe } from '../useSuperMe.jsx';
import OverviewPanel from '../OverviewPanel.jsx';

const TABS = ['Overview', 'Branding', 'Billing', 'Members'];
const PLANS = ['starter', 'pro', 'enterprise'];
const ROLES = ['manager_admin', 'accountant_admin', 'dispatcher'];
const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };

function Notice({ notice, onClose }) {
  if (!notice) return null;
  const bad = notice.startsWith('Error');
  return (
    <div className="card" style={{ padding: '10px 14px', marginBottom: 16, borderColor: bad ? 'var(--danger)' : 'var(--success)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{notice}</span><button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}>Dismiss</button>
    </div>
  );
}

function BrandingTab({ org, onSaved, setNotice }) {
  const b = org.branding || {};
  const [f, setF] = useState({ displayName: b.displayName || '', primaryColor: b.primaryColor || '', sidebarColor: b.sidebarColor || '', logoUrl: b.logoUrl || '' });
  const save = async () => {
    try {
      const updated = await api.patch(`/super/orgs/${org.id}`, { branding: {
        displayName: f.displayName.trim() || null,
        primaryColor: f.primaryColor.trim() || null,
        sidebarColor: f.sidebarColor.trim() || null,
        logoUrl: f.logoUrl.trim() || null,
      } });
      onSaved(updated);
      setNotice('Branding saved. The client workspace applies it on next load.');
    } catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  const swatch = f.primaryColor || 'var(--primary)';
  return (
    <div className="card" style={{ padding: 18, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Templates &amp; colors</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Per-workspace branding applied to this client's site — display name, accent color, sidebar color, and logo.</p>
      <Field label="Display name (overrides the product wordmark for this workspace)"><input className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="Nexus Field" /></Field>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}><Field label="Primary color"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="color" value={f.primaryColor || '#127c6e'} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} style={{ width: 42, height: 34, border: 'none', background: 'none' }} /><input className="input" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} placeholder="#127c6e" /></div></Field></div>
        <div style={{ flex: '1 1 200px' }}><Field label="Sidebar color"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="color" value={f.sidebarColor || '#0f6d61'} onChange={(e) => setF({ ...f, sidebarColor: e.target.value })} style={{ width: 42, height: 34, border: 'none', background: 'none' }} /><input className="input" value={f.sidebarColor} onChange={(e) => setF({ ...f, sidebarColor: e.target.value })} placeholder="#0f6d61" /></div></Field></div>
      </div>
      <Field label="Logo URL (optional — replaces the default mark)"><input className="input" value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://…/logo.png" /></Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: swatch, color: '#fff', fontWeight: 700, fontSize: 13 }}>
          {f.logoUrl ? <img src={f.logoUrl} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} /> : null}
          {f.displayName || 'Nexus Field'}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Preview</span>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save}>Save branding</button>
    </div>
  );
}

function BillingTab({ org, onSaved, setNotice }) {
  const me = useSuperMe();
  const [f, setF] = useState({ plan: org.plan, subscription_status: org.subscription_status || '', billing_email: org.billing_email || '' });
  const save = async () => {
    try {
      const updated = await api.patch(`/super/orgs/${org.id}`, { plan: f.plan, subscription_status: f.subscription_status, billing_email: f.billing_email });
      onSaved(updated);
      setNotice('Billing saved.');
    } catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  const openPortal = async () => {
    try {
      const { url } = await api.post(`/super/orgs/${org.id}/billing/portal`, {});
      window.open(url, '_blank', 'noopener');
    } catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  return (
    <div className="card" style={{ padding: 18, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Billing &amp; plan</h3>
      <Field label="Plan"><select className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
      <Field label="Subscription status"><input className="input" value={f.subscription_status} onChange={(e) => setF({ ...f, subscription_status: e.target.value })} placeholder="active / past_due / canceled" /></Field>
      <Field label="Billing email"><input className="input" type="email" value={f.billing_email} onChange={(e) => setF({ ...f, billing_email: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={save}>Save billing</button>
        {me.features?.payments && org.has_stripe_customer && <button className="btn" onClick={openPortal}>Open Stripe portal</button>}
      </div>
      {!me.features?.payments && <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>Stripe is not configured (set <code>STRIPE_SECRET_KEY</code>) — plan and status are managed manually here.</p>}
      {me.features?.payments && !org.has_stripe_customer && <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>No Stripe customer on file for this workspace yet, so the portal is unavailable.</p>}
    </div>
  );
}

function MembersTab({ org, reload, setNotice }) {
  const [add, setAdd] = useState({ user_email: '', name: '', role: 'dispatcher' });
  const addMember = async (e) => {
    e.preventDefault();
    try { await api.post(`/super/orgs/${org.id}/members`, add); setAdd({ user_email: '', name: '', role: 'dispatcher' }); reload(); setNotice('Member added.'); }
    catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  const changeRole = async (email, role) => { try { await api.patch(`/super/orgs/${org.id}/members/${encodeURIComponent(email)}`, { role }); reload(); } catch (ex) { setNotice(`Error: ${ex.message}`); } };
  const removeMember = async (email) => { if (!confirm(`Remove ${email}?`)) return; try { await api.del(`/super/orgs/${org.id}/members/${encodeURIComponent(email)}`); reload(); } catch (ex) { setNotice(`Error: ${ex.message}`); } };
  const seedDemo = async () => {
    try { const r = await api.post(`/super/orgs/${org.id}/demo-seed`, {}); setNotice(r.seeded ? 'Demo data loaded.' : (r.reason || 'Workspace already has data — nothing added.')); }
    catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  return (
    <>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Members</h3>
        <form onSubmit={addMember} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <input className="input" type="email" required placeholder="email@business.com" value={add.user_email} onChange={(e) => setAdd({ ...add, user_email: e.target.value })} style={{ flex: '1 1 200px' }} />
          <input className="input" placeholder="Name (optional)" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} style={{ flex: '1 1 140px' }} />
          <select className="input" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} style={{ width: 170 }}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
        {(org.members || []).map((m) => (
          <div key={m.user_email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)' }}>
            <div><div style={{ fontWeight: 600 }}>{m.name || m.user_email}</div><div className="muted" style={{ fontSize: 12 }}>{m.user_email}{m.joined_at ? '' : ' · invited'}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select className="input" value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)} style={{ width: 170 }}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <button className="btn btn-danger" style={{ padding: '5px 10px' }} onClick={() => removeMember(m.user_email)}>Remove</button>
            </div>
          </div>
        ))}
        {!(org.members || []).length && <p className="muted">No members yet.</p>}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Workspace tools</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Load a coherent demo dataset (customers, sites, assets, work orders) into this workspace. Idempotent — it won't touch a workspace that already has customers.</p>
        <button className="btn" onClick={seedDemo}>Load demo data</button>
      </div>
    </>
  );
}

export default function WorkspaceDetail() {
  const { id } = useParams();
  const [org, setOrg] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [overview, setOverview] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => api.get(`/super/orgs/${id}`).then(setOrg).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { if (tab === 'Overview' && !overview) api.get(`/super/orgs/${id}/overview`).then(setOverview).catch((e) => setErr(e.message)); }, [tab, overview, id]);

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!org) return <Loading label="Loading workspace…" />;

  return (
    <>
      <Link to="/" className="btn" style={{ marginBottom: 12, display: 'inline-flex' }}><ArrowLeft size={15} /> All workspaces</Link>
      <PageHeader title={org.branding?.displayName || org.name} subtitle={<>Workspace <code>{org.id}</code> · created {date(org.created_at)}</>} />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13.5,
              color: tab === t ? 'var(--primary)' : 'var(--text-muted)', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewPanel d={overview} />}
      {tab === 'Branding' && <BrandingTab org={org} onSaved={(u) => setOrg({ ...org, ...u })} setNotice={setNotice} />}
      {tab === 'Billing' && <BillingTab org={org} onSaved={(u) => setOrg({ ...org, ...u })} setNotice={setNotice} />}
      {tab === 'Members' && <MembersTab org={org} reload={load} setNotice={setNotice} />}
    </>
  );
}
