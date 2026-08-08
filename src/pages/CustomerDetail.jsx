import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, useResource, PageHeader, Modal, Field, Badge, date } from '../components/ui.jsx';

const term = (t) => (t || '').replace(/_/g, ' ');

// A titled card section with an optional "+ Add" button.
function Section({ title, canAdd, onAdd, addLabel, children }) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        {canAdd && <button className="btn btn-teal" onClick={onAdd}>+ {addLabel}</button>}
      </div>
      {children}
    </div>
  );
}

const SITE_BLANK = { name: '', address: '', access_notes: '', contact_name: '', contact_phone: '', status: 'active' };
const ASSET_BLANK = { name: '', category: '', manufacturer: '', model: '', serial: '', install_date: '', warranty_expires: '', status: 'active', notes: '', site_id: '' };
const WO_BLANK = { title: '', description: '', priority: 'medium', status: 'requested', site_id: '', asset_id: '', assignee_email: '' };

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const [cust, setCust] = useState(null);
  const [err, setErr] = useState(null);
  const [members, setMembers] = useState([]);

  const sites = useResource(`/sites?customer_id=${id}`);
  const assets = useResource(`/assets?customer_id=${id}`);
  const orders = useResource(`/work-orders?customer_id=${id}`);

  const [modal, setModal] = useState(null); // 'site' | 'asset' | 'wo' | null
  const [siteForm, setSiteForm] = useState(SITE_BLANK);
  const [assetForm, setAssetForm] = useState(ASSET_BLANK);
  const [woForm, setWoForm] = useState(WO_BLANK);
  const [saving, setSaving] = useState(false);

  const canSites = me.can('sites:write');
  const canAssets = me.can('assets:write');
  const canWO = me.can('work_orders:write');

  useEffect(() => {
    api.get(`/customers/${id}`).then(setCust).catch((e) => setErr(e.message));
    api.get('/members').then(setMembers).catch(() => {});
  }, [id]);

  const siteName = (sid) => sites.rows.find((s) => s.id === sid)?.name || '—';

  const addSite = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await sites.create({ ...siteForm, customer_id: id }); setModal(null); setSiteForm(SITE_BLANK); }
    finally { setSaving(false); }
  };
  const addAsset = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await assets.create({ ...assetForm, customer_id: id, site_id: assetForm.site_id || null, install_date: assetForm.install_date || null, warranty_expires: assetForm.warranty_expires || null });
      setModal(null); setAssetForm(ASSET_BLANK);
    } finally { setSaving(false); }
  };
  const addWO = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const row = await orders.create({ ...woForm, customer_id: id, site_id: woForm.site_id || null, asset_id: woForm.asset_id || null, assignee_email: woForm.assignee_email || null });
      setModal(null); setWoForm(WO_BLANK);
      nav(`/work-orders/${row.id}`);
    } finally { setSaving(false); }
  };

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!cust) return <Loading label="Loading customer…" />;

  // Assets available to attach to a work order, narrowed to the chosen site.
  const woAssets = assets.rows.filter((a) => !woForm.site_id || a.site_id === woForm.site_id);

  return (
    <>
      <PageHeader title={cust.name} subtitle={<><Link to="/customers">Customers</Link> · account</>}
        action={<Badge value={cust.status} />} />

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <div><div className="label">Billing email</div>{cust.billing_email || '—'}</div>
          <div><div className="label">Phone</div>{cust.phone || '—'}</div>
          <div><div className="label">Payment terms</div>{term(cust.payment_terms)}</div>
          <div><div className="label">PO required</div>{cust.po_required ? <span className="badge badge-amber">required</span> : 'No'}</div>
          <div style={{ gridColumn: '1 / -1' }}><div className="label">Billing address</div>{cust.billing_address || '—'}</div>
          {cust.notes && <div style={{ gridColumn: '1 / -1' }}><div className="label">Notes</div>{cust.notes}</div>}
        </div>
      </div>

      <Section title={`Sites (${sites.rows.length})`} canAdd={canSites} addLabel="Add site" onAdd={() => setModal('site')}>
        {sites.rows.length ? (
          <table className="data">
            <thead><tr><th>Name</th><th>Address</th><th>Site contact</th><th>Status</th></tr></thead>
            <tbody>
              {sites.rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.address || '—'}</td>
                  <td>{[s.contact_name, s.contact_phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td><Badge value={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">No sites yet.</p>}
      </Section>

      <Section title={`Assets (${assets.rows.length})`} canAdd={canAssets} addLabel="Add asset" onAdd={() => setModal('asset')}>
        {assets.rows.length ? (
          <table className="data">
            <thead><tr><th>Asset</th><th>Site</th><th>Make / model</th><th>Serial</th><th>Warranty</th><th>Status</th></tr></thead>
            <tbody>
              {assets.rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}{a.category && <div className="muted" style={{ fontSize: 12 }}>{a.category.replace(/_/g, ' ')}</div>}</td>
                  <td>{siteName(a.site_id)}</td>
                  <td>{[a.manufacturer, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{a.serial || '—'}</td>
                  <td>{date(a.warranty_expires)}</td>
                  <td><Badge value={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">No assets yet.</p>}
      </Section>

      <Section title={`Work orders (${orders.rows.length})`} canAdd={canWO} addLabel="New work order" onAdd={() => setModal('wo')}>
        {orders.rows.length ? (
          <table className="data">
            <thead><tr><th>#</th><th>Title</th><th>Priority</th><th>Status</th><th>Assignee</th><th>SLA due</th></tr></thead>
            <tbody>
              {orders.rows.map((w) => (
                <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/work-orders/${w.id}`)}>
                  <td style={{ fontWeight: 700 }}>{w.number || '—'}</td>
                  <td>{w.title}</td>
                  <td><Badge value={w.priority} /></td>
                  <td><Badge value={w.status} /></td>
                  <td>{w.assignee_email || '—'}</td>
                  <td>{date(w.sla_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">No work orders yet.</p>}
      </Section>

      {modal === 'site' && (
        <Modal title="Add site" onClose={() => setModal(null)}>
          <form onSubmit={addSite}>
            <Field label="Site name"><input className="input" required value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} /></Field>
            <Field label="Address"><input className="input" value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Site contact"><input className="input" value={siteForm.contact_name} onChange={(e) => setSiteForm({ ...siteForm, contact_name: e.target.value })} /></Field>
              <Field label="Contact phone"><input className="input" value={siteForm.contact_phone} onChange={(e) => setSiteForm({ ...siteForm, contact_phone: e.target.value })} /></Field>
            </div>
            <Field label="Access notes"><textarea className="input" rows={2} placeholder="Gate codes, hours, where to park…" value={siteForm.access_notes} onChange={(e) => setSiteForm({ ...siteForm, access_notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add site'}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'asset' && (
        <Modal title="Add asset" onClose={() => setModal(null)}>
          <form onSubmit={addAsset}>
            <Field label="Asset name"><input className="input" required value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Site">
                <select className="input" value={assetForm.site_id} onChange={(e) => setAssetForm({ ...assetForm, site_id: e.target.value })}>
                  <option value="">— none —</option>
                  {sites.rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Category"><input className="input" placeholder="HVAC, compressor…" value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Manufacturer"><input className="input" value={assetForm.manufacturer} onChange={(e) => setAssetForm({ ...assetForm, manufacturer: e.target.value })} /></Field>
              <Field label="Model"><input className="input" value={assetForm.model} onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })} /></Field>
              <Field label="Serial"><input className="input" value={assetForm.serial} onChange={(e) => setAssetForm({ ...assetForm, serial: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Install date"><input className="input" type="date" value={assetForm.install_date} onChange={(e) => setAssetForm({ ...assetForm, install_date: e.target.value })} /></Field>
              <Field label="Warranty expires"><input className="input" type="date" value={assetForm.warranty_expires} onChange={(e) => setAssetForm({ ...assetForm, warranty_expires: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add asset'}</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'wo' && (
        <Modal title="New work order" onClose={() => setModal(null)}>
          <form onSubmit={addWO}>
            <Field label="Title"><input className="input" required value={woForm.title} onChange={(e) => setWoForm({ ...woForm, title: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Site">
                <select className="input" value={woForm.site_id} onChange={(e) => setWoForm({ ...woForm, site_id: e.target.value, asset_id: '' })}>
                  <option value="">— none —</option>
                  {sites.rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Asset">
                <select className="input" value={woForm.asset_id} onChange={(e) => setWoForm({ ...woForm, asset_id: e.target.value })}>
                  <option value="">— none —</option>
                  {woAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Priority">
                <select className="input" value={woForm.priority} onChange={(e) => setWoForm({ ...woForm, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Assign to">
                <select className="input" value={woForm.assignee_email} onChange={(e) => setWoForm({ ...woForm, assignee_email: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description"><textarea className="input" rows={3} value={woForm.description} onChange={(e) => setWoForm({ ...woForm, description: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create work order'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
