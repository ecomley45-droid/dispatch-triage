import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, useResource, PageHeader, Modal, Field, Badge, date, useIsMobile, NameSelect } from '../components/ui.jsx';
import { TicketDetail } from './Tickets.jsx';

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

function SiteNotesModal({ site, canEdit, onClose, onSave }) {
  const [notes, setNotes] = useState(site.notes || '');
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(notes); } finally { setSaving(false); } };
  return (
    <Modal title={`${site.name} — notes`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Standing reference info for this site — separate from access notes, and visible from every work order, project, or ticket tied here.</p>
      {canEdit ? (
        <>
          <textarea className="input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button>
          </div>
        </>
      ) : <p>{site.notes || 'No notes yet.'}</p>}
    </Modal>
  );
}

const SITE_BLANK = { name: '', address: '', access_notes: '', notes: '', contact_name: '', contact_phone: '', status: 'active' };
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
  const [notesSite, setNotesSite] = useState(null);
  const [custNotes, setCustNotes] = useState('');

  const canSites = me.can('sites:write');
  const canAssets = me.can('assets:write');
  const canWO = me.can('work_orders:write');
  const canCust = me.can('customers:write');
  const canTickets = me.can('tickets:write');
  const [tickets, setTickets] = useState([]);
  const [selTicket, setSelTicket] = useState(null);
  const loadTickets = () => api.get(`/tickets?customer_id=${id}`).then(setTickets).catch(() => setTickets([]));
  const newTicket = async () => {
    const subject = prompt('Ticket subject?');
    if (!subject?.trim()) return;
    const body = prompt('First message to the customer (leave blank to skip):') || '';
    const t = await api.post('/tickets', { subject: subject.trim(), body: body.trim(), customer_id: id });
    await loadTickets(); setSelTicket(t);
  };
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);
  const portalUrl = cust?.portal_token ? `${window.location.origin}/portal/${cust.portal_token}` : '';
  const copyPortal = async () => { try { await navigator.clipboard.writeText(portalUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  const rotatePortal = async () => {
    if (!confirm('Generate a new link? The current link will stop working.')) return;
    const r = await api.post(`/customers/${id}/portal-token`, {});
    setCust((c) => ({ ...c, portal_token: r.portal_token }));
  };

  useEffect(() => {
    api.get(`/customers/${id}`).then((c) => { setCust(c); setCustNotes(c.notes || ''); }).catch((e) => setErr(e.message));
    api.get('/members').then(setMembers).catch(() => {});
    loadTickets();
  }, [id]);

  const saveCustNotes = async () => {
    if (custNotes === (cust.notes || '')) return;
    const c = await api.patch(`/customers/${id}`, { notes: custNotes });
    setCust(c);
  };
  const saveSiteNotes = async (notes) => {
    await api.patch(`/sites/${notesSite.id}`, { notes });
    setNotesSite(null); sites.reload();
  };

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
          <div style={{ minWidth: 0, overflowWrap: 'break-word' }}><div className="label">Billing email</div>{cust.billing_email || '—'}</div>
          <div style={{ minWidth: 0, overflowWrap: 'break-word' }}><div className="label">Phone</div>{cust.phone || '—'}</div>
          <div><div className="label">Payment terms</div>{term(cust.payment_terms)}</div>
          <div><div className="label">PO required</div>{cust.po_required ? <span className="badge badge-amber">required</span> : 'No'}</div>
          <div style={{ gridColumn: '1 / -1' }}><div className="label">Billing address</div>{cust.billing_address || '—'}</div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="label">Notes <span style={{ fontWeight: 400 }}>— reference info shared across every work order, project, and ticket for this customer</span></div>
            {canCust ? (
              <textarea className="input" rows={2} value={custNotes} onChange={(e) => setCustNotes(e.target.value)} onBlur={saveCustNotes} placeholder="Nothing yet…" />
            ) : (cust.notes || '—')}
          </div>
        </div>
      </div>

      {canCust && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Customer portal</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Share this private link so {cust.name} can request service and see their work orders and invoices — no login needed.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" readOnly value={portalUrl} onFocus={(e) => e.target.select()} style={{ flex: '1 1 260px' }} />
            <button className="btn btn-teal" onClick={copyPortal}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            <a className="btn" href={portalUrl} target="_blank" rel="noreferrer">Open</a>
            <button className="btn btn-danger" onClick={rotatePortal}>Regenerate</button>
          </div>
        </div>
      )}

      <Section title={`Sites (${sites.rows.length})`} canAdd={canSites} addLabel="Add site" onAdd={() => setModal('site')}>
        {!sites.rows.length ? <p className="muted">No sites yet.</p> : isMobile ? (
          <div className="m-cards">
            {sites.rows.map((s) => (
              <button key={s.id} className="m-card" onClick={() => setNotesSite(s)}>
                <div className="m-card-head"><div><div className="m-title">{s.name}</div><div className="m-meta">{s.address || '—'}</div></div><Badge value={s.status} /></div>
                <div className="m-facts"><span>{[s.contact_name, s.contact_phone].filter(Boolean).join(' · ') || 'No contact'}</span></div>
                {s.notes && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>📝 {s.notes}</div>}
              </button>
            ))}
          </div>
        ) : (
          <table className="data">
            <thead><tr><th>Name</th><th>Address</th><th>Site contact</th><th>Notes</th><th>Status</th></tr></thead>
            <tbody>
              {sites.rows.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setNotesSite(s)} title="Click to view/edit site notes">
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.address || '—'}</td>
                  <td>{[s.contact_name, s.contact_phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.notes || '—'}</td>
                  <td><Badge value={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Assets (${assets.rows.length})`} canAdd={canAssets} addLabel="Add asset" onAdd={() => setModal('asset')}>
        {!assets.rows.length ? <p className="muted">No assets yet.</p> : isMobile ? (
          <div className="m-cards">
            {assets.rows.map((a) => (
              <div key={a.id} className="m-card" style={{ cursor: 'default' }}>
                <div className="m-card-head"><div><div className="m-title">{a.name}</div><div className="m-meta">{siteName(a.site_id)}{a.category ? ` · ${a.category.replace(/_/g, ' ')}` : ''}</div></div><Badge value={a.status} /></div>
                <div className="m-facts"><span>{[a.manufacturer, a.model].filter(Boolean).join(' ') || '—'}</span><span>SN {a.serial || '—'}</span><span>Warr {date(a.warranty_expires)}</span></div>
              </div>
            ))}
          </div>
        ) : (
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
        )}
      </Section>

      <Section title={`Work orders (${orders.rows.length})`} canAdd={canWO} addLabel="New work order" onAdd={() => setModal('wo')}>
        {!orders.rows.length ? <p className="muted">No work orders yet.</p> : isMobile ? (
          <div className="m-cards">
            {orders.rows.map((w) => (
              <button key={w.id} className="m-card" onClick={() => nav(`/work-orders/${w.id}`)}>
                <div className="m-card-head"><div><div className="m-title">{w.number ? `${w.number} · ` : ''}{w.title}</div></div><Badge value={w.status} /></div>
                <div className="m-facts"><span>Priority <b>{w.priority}</b></span><span>{w.assignee_email ? w.assignee_email.split('@')[0] : 'unassigned'}</span><span>SLA {date(w.sla_due)}</span></div>
              </button>
            ))}
          </div>
        ) : (
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
        )}
      </Section>

      <Section title={`Tickets (${tickets.length})`} canAdd={canTickets} addLabel="New ticket" onAdd={newTicket}>
        {!tickets.length ? <p className="muted">No tickets. Messages the customer sends from their portal appear here.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {tickets.map((t) => (
              <button key={t.id} onClick={() => setSelTicket(t)}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', padding: '10px 0', cursor: 'pointer' }}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t.number}</span>
                <Badge value={t.status} />
                <span style={{ fontWeight: 600 }}>{t.subject}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{t.last_message_at ? new Date(t.last_message_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      {selTicket && (
        <Modal title={`Ticket ${selTicket.number || ''}`} onClose={() => setSelTicket(null)}>
          <TicketDetail ticket={selTicket} canReply={canTickets} onChange={(t) => { setSelTicket(t); loadTickets(); }} />
        </Modal>
      )}

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
            <Field label="Notes"><textarea className="input" rows={2} placeholder="Standing reference info for this site…" value={siteForm.notes} onChange={(e) => setSiteForm({ ...siteForm, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add site'}</button>
            </div>
          </form>
        </Modal>
      )}

      {notesSite && (
        <SiteNotesModal site={notesSite} canEdit={canSites} onClose={() => setNotesSite(null)} onSave={saveSiteNotes} />
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
                <NameSelect members={members} value={woForm.assignee_email} onChange={(v) => setWoForm({ ...woForm, assignee_email: v })} placeholder="— unassigned —" />
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
