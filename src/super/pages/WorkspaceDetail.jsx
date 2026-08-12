import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Loading, date } from '../../components/ui.jsx';
import { useSuperMe } from '../useSuperMe.jsx';
import OverviewPanel from '../OverviewPanel.jsx';
import { FEATURE_FLAGS, INTEGRATION_FLAGS, featureEnabled, featureActive, featureLabel } from '../../../lib/permissions.js';

const TABS = ['Overview', 'Branding', 'Integrations', 'Billing', 'Members'];
const PLANS = ['starter', 'pro', 'enterprise'];

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
  const [f, setF] = useState({ displayName: b.displayName || '', primaryColor: b.primaryColor || '', sidebarColor: b.sidebarColor || '', logoUrl: b.logoUrl || '', faviconUrl: b.faviconUrl || '' });
  const save = async () => {
    try {
      const updated = await api.patch(`/super/orgs/${org.id}`, { branding: {
        displayName: f.displayName.trim() || null,
        primaryColor: f.primaryColor.trim() || null,
        sidebarColor: f.sidebarColor.trim() || null,
        logoUrl: f.logoUrl.trim() || null,
        faviconUrl: f.faviconUrl.trim() || null,
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
      <Field label="Favicon URL (optional — the browser-tab icon for this workspace)">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {f.faviconUrl ? <img src={f.faviconUrl} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', border: '1px solid var(--border)' }} /> : null}
          <input className="input" value={f.faviconUrl} onChange={(e) => setF({ ...f, faviconUrl: e.target.value })} placeholder="https://…/favicon.ico (or .png)" />
        </div>
      </Field>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: swatch, color: '#fff', fontWeight: 700, fontSize: 13 }}>
            {f.logoUrl ? <img src={f.logoUrl} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} /> : null}
            {f.displayName || 'Nexus Field'}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Sidebar preview</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: f.logoUrl ? 'transparent' : (f.primaryColor || '#127c6e'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.25)', flexShrink: 0,
          }}>
            {f.logoUrl
              ? <img src={f.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ color: '#fff', fontWeight: 800, fontSize: 26 }}>{(f.displayName || org.name || 'N').charAt(0).toUpperCase()}</span>
            }
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, maxWidth: 80, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(f.displayName || org.name || 'Nexus Field').slice(0, 14)}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>Home screen icon</div>
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save}>Save branding</button>
    </div>
  );
}

// Toggle switch that matches the app UI (a labeled pill).
function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      style={{ width: 44, height: 26, borderRadius: 999, border: '1px solid var(--border)', background: checked ? 'var(--primary)' : 'var(--surface-2)', position: 'relative', cursor: disabled ? 'default' : 'pointer', transition: 'background .15s', flex: '0 0 auto' }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .15s' }} />
    </button>
  );
}

// Ordered, de-duplicated list of feature groups (preserves catalog order).
const FEATURE_GROUPS = FEATURE_FLAGS.reduce((gs, f) => (gs.includes(f.group) ? gs : [...gs, f.group]), []);
// Features on the roadmap but not yet built — shown as "coming soon" so the
// toggle list reads as complete without pretending to gate something that
// doesn't exist yet.
const COMING_SOON = ['Public online booking widget', 'Price book / flat-rate pricing', 'Integrations marketplace / Zapier'];

function IntegrationsTab({ org, onSaved, setNotice }) {
  const ff = org.feature_flags || {};
  const [features, setFeatures] = useState(Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, featureEnabled(ff, f.key)])));
  const [integrations, setIntegrations] = useState(Object.fromEntries(INTEGRATION_FLAGS.map((i) => [i.key, ff.integrations?.[i.key] !== false])));
  const [saving, setSaving] = useState(false);
  const save = async (nextFeatures, nextIntegrations) => {
    setSaving(true); setNotice(null);
    try {
      const updated = await api.patch(`/super/orgs/${org.id}`, { feature_flags: { features: nextFeatures, integrations: nextIntegrations } });
      onSaved(updated); setNotice('Saved. The workspace applies it on next load.');
    } catch (ex) { setNotice(`Error: ${ex.message}`); } finally { setSaving(false); }
  };
  const setFeature = (k, v) => { const next = { ...features, [k]: v }; setFeatures(next); save(next, integrations); };
  const setIntegration = (k, v) => { const next = { ...integrations, [k]: v }; setIntegrations(next); save(features, next); };
  // "Active" folds in dependencies, so a module whose prerequisite is off reads
  // as off (and locked) even if its own flag was never touched.
  const active = (key) => featureActive({ features }, key);

  const Row = ({ label, sub, checked, onChange, disabled }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)', opacity: disabled && !saving ? 0.6 : 1 }}>
      <div><div style={{ fontWeight: 600 }}>{label}</div>{sub && <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div>}</div>
      <Toggle checked={checked} onChange={onChange} disabled={saving || disabled} />
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 620 }}>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Features</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Turn modules on or off for this workspace. A disabled module disappears everywhere — navigation, pages, and API — while everything else keeps working. Options that depend on another module unlock once you enable it.</p>
        {FEATURE_GROUPS.map((g) => (
          <div key={g} style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>{g}</div>
            {FEATURE_FLAGS.filter((f) => f.group === g).map((f) => {
              const reqs = f.requires || [];
              const locked = reqs.some((r) => !active(r));
              return (
                <Row key={f.key} label={f.label}
                  sub={locked ? `Requires ${reqs.map(featureLabel).join(' + ')}` : undefined}
                  checked={active(f.key)} disabled={locked}
                  onChange={(v) => setFeature(f.key, v)} />
              );
            })}
          </div>
        ))}
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
          <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Coming soon</div>
          {COMING_SOON.map((label) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }}>
              <div className="muted" style={{ fontWeight: 500 }}>{label}</div>
              <span className="badge" style={{ fontSize: 11 }}>Not built yet</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Integrations</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Which third-party integrations this workspace may connect. The workspace enters its own credentials in its Settings.</p>
        {INTEGRATION_FLAGS.map((i) => <Row key={i.key} label={i.label} sub="Workspace configures its own API credentials" checked={!!integrations[i.key]} onChange={(v) => setIntegration(i.key, v)} />)}
      </div>
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
  const roleList = org.roles || [];
  const [add, setAdd] = useState({ user_email: '', name: '', role: 'dispatcher' });
  const addMember = async (e) => {
    e.preventDefault();
    try { await api.post(`/super/orgs/${org.id}/members`, add); setAdd({ user_email: '', name: '', role: 'dispatcher' }); reload(); setNotice('Member added.'); }
    catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  const changeRole = async (email, role) => { try { await api.patch(`/super/orgs/${org.id}/members/${encodeURIComponent(email)}`, { role }); reload(); } catch (ex) { setNotice(`Error: ${ex.message}`); } };
  const removeMember = async (email) => { if (!confirm(`Remove ${email}?`)) return; try { await api.del(`/super/orgs/${org.id}/members/${encodeURIComponent(email)}`); reload(); } catch (ex) { setNotice(`Error: ${ex.message}`); } };
  const seedDemo = async () => {
    try { const r = await api.post(`/super/orgs/${org.id}/demo-seed`, {}); setNotice(r.seeded ? `Demo data loaded — ${r.created.customers} customers, ${r.created.members} demo users across regions.` : (r.reason || 'Workspace already has data — nothing added.')); reload(); }
    catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  const flushDemo = async () => {
    if (!confirm(`Eliminate ALL demo/business data from ${org.name}?\n\nThis removes customers, work orders, invoices, tickets, regions, teams, and demo users. Real members, roles, and saved integrations are kept. This cannot be undone.`)) return;
    try { const r = await api.post(`/super/orgs/${org.id}/demo-flush`, {}); const total = Object.values(r.removed || {}).reduce((s, v) => s + (Number(v) || 0), 0); setNotice(`Demo data eliminated — ${total} records removed.`); reload(); }
    catch (ex) { setNotice(`Error: ${ex.message}`); }
  };
  return (
    <>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Members</h3>
        <form onSubmit={addMember} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <input className="input" type="email" required placeholder="email@business.com" value={add.user_email} onChange={(e) => setAdd({ ...add, user_email: e.target.value })} style={{ flex: '1 1 200px' }} />
          <input className="input" placeholder="Name (optional)" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} style={{ flex: '1 1 140px' }} />
          <select className="input" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} style={{ width: 170 }}>{roleList.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
        {(org.members || []).map((m) => (
          <div key={m.user_email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)' }}>
            <div><div style={{ fontWeight: 600 }}>{m.name || m.user_email}</div><div className="muted" style={{ fontSize: 12 }}>{m.user_email}{m.joined_at ? '' : ' · invited'}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select className="input" value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)} style={{ width: 170 }}>{roleList.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
              <button className="btn btn-danger" style={{ padding: '5px 10px' }} onClick={() => removeMember(m.user_email)}>Remove</button>
            </div>
          </div>
        ))}
        {!(org.members || []).length && <p className="muted">No members yet.</p>}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Workspace tools</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Load a full demo dataset — SE-US customers across Georgia / South Carolina / North Carolina regions, teams, and a demo user for every role (manager, accountant, region dispatchers, technicians) so you can “view as” and see the permission model in action. Won’t touch a workspace that already has customers.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={seedDemo}>Load demo data</button>
          <button className="btn btn-danger" onClick={flushDemo}>Eliminate demo data</button>
        </div>
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
      {tab === 'Integrations' && <IntegrationsTab org={org} onSaved={(u) => setOrg({ ...org, ...u })} setNotice={setNotice} />}
      {tab === 'Billing' && <BillingTab org={org} onSaved={(u) => setOrg({ ...org, ...u })} setNotice={setNotice} />}
      {tab === 'Members' && <MembersTab org={org} reload={load} setNotice={setNotice} />}
    </>
  );
}
