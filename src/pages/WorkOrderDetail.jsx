import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Badge, Modal, Field, money, date } from '../components/ui.jsx';
import ImageInput from '../components/ImageInput.jsx';

const STATUSES = ['requested', 'scheduled', 'en_route', 'on_site', 'completed', 'invoiced', 'cancelled'];
const OPEN = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const toLocalInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const LINE_BLANK = { kind: 'labor', description: '', quantity: 1, unit_cost: 0, unit_price: 0, item_id: '' };

export default function WorkOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const [wo, setWo] = useState(null);
  const [err, setErr] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [site, setSite] = useState(null);
  const [asset, setAsset] = useState(null);
  const [members, setMembers] = useState([]);
  const [items, setItems] = useState([]);
  const [feed, setFeed] = useState([]);

  const lines = useResource(`/work-order-lines?work_order_id=${id}`);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [lineOpen, setLineOpen] = useState(false);
  const [lineForm, setLineForm] = useState(LINE_BLANK);
  const [resolution, setResolution] = useState('');
  const [sign, setSign] = useState({ signature_name: '', signature_url: '' });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const canWO = me.can('work_orders:write');
  const canLines = me.can('wo_lines:write');
  const canPost = me.can('attachments:write');

  const loadWO = () => api.get(`/work-orders/${id}`).then((w) => {
    setWo(w);
    setResolution(w.resolution_notes || '');
    setSign({ signature_name: w.signature_name || '', signature_url: w.signature_url || '' });
    if (w.customer_id) api.get(`/customers/${w.customer_id}`).then(setCustomer).catch(() => {});
    if (w.site_id) api.get(`/sites/${w.site_id}`).then(setSite).catch(() => {});
    if (w.asset_id) api.get(`/assets/${w.asset_id}`).then(setAsset).catch(() => {});
  }).catch((e) => setErr(e.message));

  const loadFeed = () => api.list(`/attachments?entity_type=work_order&entity_id=${id}`).then(setFeed).catch(() => setFeed([]));

  useEffect(() => {
    loadWO(); loadFeed();
    api.get('/members').then(setMembers).catch(() => {});
    api.list('/items').then(setItems).catch(() => {});
  }, [id]);

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!wo) return <p className="muted">Loading work order…</p>;

  const patch = async (body) => { setWo(await api.patch(`/work-orders/${id}`, body)); };
  const setStatus = (status) => {
    const body = { status };
    if (status === 'completed' && !wo.completed_at) body.completed_at = new Date().toISOString();
    patch(body);
  };

  const openEdit = () => {
    setEditForm({
      priority: wo.priority, assignee_email: wo.assignee_email || '', requested_by: wo.requested_by || '',
      sla_due: toLocalInput(wo.sla_due), scheduled_start: toLocalInput(wo.scheduled_start), scheduled_end: toLocalInput(wo.scheduled_end),
    });
    setEditOpen(true);
  };
  const saveEdit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await patch({
        priority: editForm.priority,
        assignee_email: editForm.assignee_email || null,
        requested_by: editForm.requested_by || null,
        sla_due: editForm.sla_due ? new Date(editForm.sla_due).toISOString() : null,
        scheduled_start: editForm.scheduled_start ? new Date(editForm.scheduled_start).toISOString() : null,
        scheduled_end: editForm.scheduled_end ? new Date(editForm.scheduled_end).toISOString() : null,
      });
      setEditOpen(false);
    } finally { setSaving(false); }
  };

  const addLine = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await lines.create({
        work_order_id: id, kind: lineForm.kind, description: lineForm.description,
        quantity: Number(lineForm.quantity), unit_cost: Number(lineForm.unit_cost), unit_price: Number(lineForm.unit_price),
        item_id: lineForm.item_id || null,
      });
      setLineOpen(false); setLineForm(LINE_BLANK);
    } finally { setSaving(false); }
  };

  const onPickItem = (itemId) => {
    const it = items.find((i) => i.id === itemId);
    setLineForm((f) => ({ ...f, item_id: itemId, kind: itemId ? 'part' : f.kind, description: it ? it.name : f.description, unit_cost: it ? Number(it.unit_cost) : f.unit_cost }));
  };

  const saveResolution = async () => { setSaving(true); try { await patch({ resolution_notes: resolution }); } finally { setSaving(false); } };
  const saveSignoff = async () => { setSaving(true); try { await patch({ signature_name: sign.signature_name || null, signature_url: sign.signature_url || null }); } finally { setSaving(false); } };

  const postNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    await api.post('/attachments', { entity_type: 'work_order', entity_id: id, kind: 'note', url: '', caption: note.trim() });
    setNote(''); loadFeed();
  };
  const postPhoto = async (url) => {
    if (!url) return;
    await api.post('/attachments', { entity_type: 'work_order', entity_id: id, kind: 'photo', url, caption: '' });
    loadFeed();
  };

  const totalCost = lines.rows.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_cost), 0);
  const totalBillable = lines.rows.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
  const margin = totalBillable - totalCost;
  const overdue = OPEN.has(wo.status) && wo.sla_due && new Date(wo.sla_due) < new Date();

  return (
    <>
      <PageHeader
        title={`${wo.number ? wo.number + ' · ' : ''}${wo.title}`}
        subtitle={<><Link to="/work-orders">Work orders</Link>{customer && <> · <Link to={`/customers/${customer.id}`}>{customer.name}</Link></>}</>}
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => nav(`/work-orders/${id}/invoice`)}>Invoice / report</button>
          <Badge value={wo.priority} />
          {canWO ? (
            <select className="input" style={{ width: 'auto' }} value={wo.status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          ) : <Badge value={wo.status} />}
        </div>} />

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <div><div className="label">Site</div>{site ? site.name : '—'}{site?.address && <div className="muted" style={{ fontSize: 12 }}>{site.address}</div>}</div>
          <div><div className="label">Asset</div>{asset ? asset.name : '—'}{asset?.serial && <div className="muted" style={{ fontSize: 12 }}>SN {asset.serial}</div>}</div>
          <div><div className="label">Assignee</div>{wo.assignee_email || '— unassigned —'}</div>
          <div><div className="label">Requested by</div>{wo.requested_by || '—'}</div>
          <div><div className="label">SLA due</div><span className={overdue ? 'badge badge-red' : ''}>{when(wo.sla_due)}{overdue ? ' · overdue' : ''}</span></div>
          <div><div className="label">Scheduled</div>{wo.scheduled_start ? `${when(wo.scheduled_start)} – ${when(wo.scheduled_end)}` : '—'}</div>
          {site?.access_notes && <div style={{ gridColumn: '1 / -1' }}><div className="label">Site access</div>{site.access_notes}</div>}
          {wo.description && <div style={{ gridColumn: '1 / -1' }}><div className="label">Description</div><div style={{ whiteSpace: 'pre-wrap' }}>{wo.description}</div></div>}
        </div>
        {canWO && <div style={{ marginTop: 12 }}><button className="btn" onClick={openEdit}>Edit details</button></div>}
      </div>

      {/* Line items */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Line items</h3>
          {canLines && <button className="btn btn-teal" onClick={() => setLineOpen(true)}>+ Add line</button>}
        </div>
        {lines.rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: 620 }}>
              <thead><tr><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit cost</th><th style={{ textAlign: 'right' }}>Unit price</th><th style={{ textAlign: 'right' }}>Billable</th>{canLines && <th />}</tr></thead>
              <tbody>
                {lines.rows.map((l) => (
                  <tr key={l.id}>
                    <td><Badge value={l.kind} /></td>
                    <td>{l.description}</td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantity)}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.unit_cost)}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(l.quantity) * Number(l.unit_price))}</td>
                    {canLines && <td style={{ textAlign: 'right' }}><button className="btn btn-danger" onClick={() => lines.remove(l.id)}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} />
                  <td style={{ textAlign: 'right' }} className="muted">Cost {money(totalCost)}</td>
                  <td style={{ textAlign: 'right' }} className="muted">Margin {money(margin)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800 }}>{money(totalBillable)}</td>
                  {canLines && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <p className="muted">No line items yet.</p>}
      </div>

      {/* Resolution + sign-off */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Resolution</h3>
          <textarea className="input" rows={4} placeholder="What was found and fixed…" value={resolution} disabled={!canWO} onChange={(e) => setResolution(e.target.value)} />
          {canWO && <div style={{ marginTop: 10, textAlign: 'right' }}><button className="btn btn-primary" disabled={saving} onClick={saveResolution}>Save resolution</button></div>}
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Customer sign-off</h3>
          <Field label="Signed by (printed name)"><input className="input" value={sign.signature_name} disabled={!canWO} onChange={(e) => setSign({ ...sign, signature_name: e.target.value })} /></Field>
          <div className="label">Signature</div>
          {canWO
            ? <ImageInput value={sign.signature_url} onChange={(url) => setSign({ ...sign, signature_url: url })} label="signature" />
            : (sign.signature_url ? <img src={sign.signature_url} alt="signature" loading="lazy" decoding="async" style={{ maxWidth: 220, border: '1px solid var(--border)', borderRadius: 8 }} /> : <span className="muted">Not signed</span>)}
          {canWO && <div style={{ marginTop: 10, textAlign: 'right' }}><button className="btn btn-primary" disabled={saving} onClick={saveSignoff}>Save sign-off</button></div>}
        </div>
      </div>

      {/* Activity + photos */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Activity &amp; photos</h3>
        {canPost && (
          <form onSubmit={postNote} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className="btn">Post</button>
            <ImageInput value="" onChange={postPhoto} label="photo" />
          </form>
        )}
        {feed.length ? feed.map((a) => (
          <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{a.created_by || 'Someone'}</span>
              <span className="muted" style={{ fontSize: 12 }}>{when(a.created_at)}</span>
            </div>
            {a.kind === 'photo'
              ? <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.caption || 'Work order photo'} loading="lazy" decoding="async" style={{ marginTop: 6, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} /></a>
              : <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.caption}</div>}
          </div>
        )) : <p className="muted">No activity yet.</p>}
      </div>

      {editOpen && (
        <Modal title="Edit work order" onClose={() => setEditOpen(false)}>
          <form onSubmit={saveEdit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Priority">
                <select className="input" value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Assign to">
                <select className="input" value={editForm.assignee_email} onChange={(e) => setEditForm({ ...editForm, assignee_email: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Requested by (customer contact)"><input className="input" value={editForm.requested_by} onChange={(e) => setEditForm({ ...editForm, requested_by: e.target.value })} /></Field>
            <Field label="SLA due"><input className="input" type="datetime-local" value={editForm.sla_due} onChange={(e) => setEditForm({ ...editForm, sla_due: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Scheduled start"><input className="input" type="datetime-local" value={editForm.scheduled_start} onChange={(e) => setEditForm({ ...editForm, scheduled_start: e.target.value })} /></Field>
              <Field label="Scheduled end"><input className="input" type="datetime-local" value={editForm.scheduled_end} onChange={(e) => setEditForm({ ...editForm, scheduled_end: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {lineOpen && (
        <Modal title="Add line item" onClose={() => setLineOpen(false)}>
          <form onSubmit={addLine}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Type">
                <select className="input" value={lineForm.kind} onChange={(e) => setLineForm({ ...lineForm, kind: e.target.value })}>
                  {['labor', 'part', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Link a part (optional)">
                <select className="input" value={lineForm.item_id} onChange={(e) => onPickItem(e.target.value)}>
                  <option value="">— none —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description"><input className="input" required value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label={lineForm.kind === 'labor' ? 'Hours' : 'Qty'}><input className="input" type="number" step="0.25" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} /></Field>
              <Field label="Unit cost ($)"><input className="input" type="number" step="0.01" value={lineForm.unit_cost} onChange={(e) => setLineForm({ ...lineForm, unit_cost: e.target.value })} /></Field>
              <Field label="Unit price ($)"><input className="input" type="number" step="0.01" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setLineOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add line'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
