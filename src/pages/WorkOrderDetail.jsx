import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, useResource, PageHeader, Badge, Modal, Field, money, date, NameSelect } from '../components/ui.jsx';
import ImageInput from '../components/ImageInput.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import { enqueue, getForEntity } from '../lib/outbox.js';
import { enqueuePhoto } from '../lib/upload.js';

const STATUSES = ['requested', 'scheduled', 'en_route', 'on_site', 'completed', 'invoiced', 'cancelled'];
// A field tech's status dropdown is deliberately narrower than the full set
// above — they move a job through its physical stages, not its paperwork
// stages (requested/scheduled/invoiced/cancelled stay a dispatcher's call).
const TECH_STATUSES = ['en_route', 'on_site', 'completed'];
const OPEN = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const toLocalInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const LINE_BLANK = { kind: 'labor', description: '', quantity: 1, unit_cost: 0, unit_price: 0, item_id: '' };
const NEW_ITEM_BLANK = { name: '', sku: '', unit_cost: '', image_url: '' };

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
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addItemQty, setAddItemQty] = useState(1);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItem, setNewItem] = useState(NEW_ITEM_BLANK);
  const [signOpen, setSignOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const [sign, setSign] = useState({ signature_name: '', signature_url: '' });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState([]);

  const canWO = me.can('work_orders:write');
  const canLines = me.can('wo_lines:write');
  const canAddItem = me.can('wo_lines:add_item');
  const canTechUpdate = me.can('work_orders:tech_update');
  const canEditSignoff = canWO || canTechUpdate;
  const canPost = me.can('attachments:write');
  const canInvoice = me.can('invoices:write');
  const canCreateItem = me.can('items:create');
  const [invoicing, setInvoicing] = useState(false);

  const createInvoice = async () => {
    setInvoicing(true);
    try { const inv = await api.post(`/work-orders/${id}/invoice`, {}); nav(`/invoices/${inv.id}`); }
    catch (e) { alert(e.message); setInvoicing(false); }
  };

  const loadWO = () => api.get(`/work-orders/${id}`).then((w) => {
    setWo(w);
    setResolution(w.resolution_notes || '');
    setSign({ signature_name: w.signature_name || '', signature_url: w.signature_url || '' });
    // Scoped to this one work order (not the full Customers page) so a
    // technician with work-order access but not Customers still sees
    // Site/Asset here instead of "—".
    api.get(`/work-orders/${id}/related`).then(({ customer, site, asset }) => {
      if (customer) setCustomer(customer);
      if (site) setSite(site);
      if (asset) setAsset(asset);
    }).catch(() => {});
  }).catch((e) => setErr(e.message));

  const loadFeed = () => api.list(`/attachments?entity_type=work_order&entity_id=${id}`).then(setFeed).catch(() => setFeed([]));
  const loadPending = () => getForEntity('work_order', id).then(setPending).catch(() => {});

  useEffect(() => {
    loadWO(); loadFeed(); loadPending();
    api.get('/members').then(setMembers).catch(() => {});
    api.list('/items').then(setItems).catch(() => {});
    const onSynced = () => { loadFeed(); loadPending(); };
    window.addEventListener('outbox-synced', onSynced);
    return () => window.removeEventListener('outbox-synced', onSynced);
  }, [id]);

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!wo) return <Loading label="Loading work order…" />;

  const patch = async (body) => { setWo(await api.patch(`/work-orders/${id}`, body)); };
  // Resolution + sign-off go through the narrower tech-update endpoint (it
  // accepts those fields from anyone with work_orders:tech_update OR full
  // work_orders:write) so a technician saving a resolution doesn't 403.
  const patchTech = async (body) => { setWo(await api.patch(`/work-orders/${id}/tech-update`, body)); };
  const setStatus = (status) => {
    const body = { status };
    if (status === 'completed' && !wo.completed_at) body.completed_at = new Date().toISOString();
    patch(body);
  };
  const setTechStatus = (status) => {
    const body = { status };
    if (status === 'completed' && !wo.completed_at) body.completed_at = new Date().toISOString();
    patchTech(body);
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

  // Field-tech "Add item": just the item + quantity used — no cost/price
  // entry (that's a manager's call, made later on the full line-item view).
  const submitAddItem = async (e) => {
    e.preventDefault();
    if (!addItemId) return;
    setSaving(true);
    try {
      await api.post(`/work-orders/${id}/add-item`, { item_id: addItemId, quantity: Number(addItemQty) || 1 });
      await lines.reload();
      setAddItemOpen(false); setAddItemId(''); setAddItemQty(1);
    } finally { setSaving(false); }
  };
  const submitNewItem = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.post('/items', { ...newItem, unit_cost: newItem.unit_cost === '' ? 0 : Number(newItem.unit_cost), unit: 'each' });
      setItems((rows) => [created, ...rows]);
      setNewItem(NEW_ITEM_BLANK);
      setAddItemId(created.id); // hand straight back to Add item, pre-selected
      setNewItemOpen(false); setAddItemOpen(true);
    } finally { setSaving(false); }
  };

  const saveResolution = async () => { setSaving(true); try { await patchTech({ resolution_notes: resolution }); } finally { setSaving(false); } };
  const saveSignoff = async (extra = {}) => {
    setSaving(true);
    try { await patchTech({ signature_name: sign.signature_name || null, signature_url: sign.signature_url || null, ...extra }); }
    finally { setSaving(false); }
  };
  const onSignatureSaved = ({ url }) => {
    setSign((s) => ({ ...s, signature_url: url }));
    setSignOpen(false);
    saveSignoff({ signature_url: url });
  };

  const postNote = async (e) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    setNote('');
    try {
      await api.post('/attachments', { entity_type: 'work_order', entity_id: id, kind: 'note', url: '', caption: text });
      loadFeed();
    } catch (err) {
      if (err instanceof TypeError || !navigator.onLine) {
        await enqueue({ type: 'note', entity_type: 'work_order', entity_id: id, caption: text });
        loadPending();
      } else throw err;
    }
  };
  const postPhoto = async ({ url, pending: isPending, b64, filename, contentType }) => {
    if (!url) return;
    if (isPending) {
      // Upload failed offline — queue the whole upload + attach job.
      await enqueuePhoto({ b64, filename, contentType, entityType: 'work_order', entityId: id });
      loadPending();
      return;
    }
    try {
      await api.post('/attachments', { entity_type: 'work_order', entity_id: id, kind: 'photo', url, caption: '' });
      loadFeed();
    } catch (err) {
      if (err instanceof TypeError || !navigator.onLine) {
        // Upload succeeded but attaching failed — queue just the attach.
        await enqueue({ type: 'note', entity_type: 'work_order', entity_id: id, kind: 'photo', url, caption: '' });
        loadPending();
      } else throw err;
    }
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
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => nav(`/work-orders/${id}/invoice`)}>Print report</button>
          {me.features?.sms && canWO && (
            <button className="btn" onClick={async () => { try { const r = await api.post(`/work-orders/${id}/notify`, {}); alert(r.sent ? 'Customer texted: on the way.' : 'No customer phone on file.'); } catch (e) { alert(e.message); } }}>Text “on the way”</button>
          )}
          {canInvoice && <button className="btn" disabled={invoicing} onClick={createInvoice}>{invoicing ? 'Creating…' : 'Create invoice'}</button>}
          <Badge value={wo.priority} />
          {canWO ? (
            <select className="input" style={{ width: 'auto' }} value={wo.status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          ) : canTechUpdate ? (
            <select className="input" style={{ width: 'auto' }} value={wo.status} onChange={(e) => setTechStatus(e.target.value)}>
              {/* The job may still be sitting at a dispatcher-only status (e.g. "requested")
                  until it's handed off — show it so the dropdown isn't blank, even though
                  a tech can't pick it themselves. */}
              {!TECH_STATUSES.includes(wo.status) && <option value={wo.status} disabled>{wo.status.replace(/_/g, ' ')}</option>}
              {TECH_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          ) : <Badge value={wo.status} />}
        </div>} />

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
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
          {canLines
            ? <button className="btn btn-teal" onClick={() => setLineOpen(true)}>+ Add line</button>
            : canAddItem && <button className="btn btn-teal" onClick={() => setAddItemOpen(true)}>+ Add item</button>}
        </div>
        {lines.rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ minWidth: canLines ? 620 : 320 }}>
              <thead><tr><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th>{canLines && <><th style={{ textAlign: 'right' }}>Unit cost</th><th style={{ textAlign: 'right' }}>Unit price</th><th style={{ textAlign: 'right' }}>Billable</th><th /></>}</tr></thead>
              <tbody>
                {lines.rows.map((l) => (
                  <tr key={l.id}>
                    <td><Badge value={l.kind} /></td>
                    <td>{l.description}</td>
                    <td style={{ textAlign: 'right' }}>{Number(l.quantity)}</td>
                    {canLines && <>
                      <td style={{ textAlign: 'right' }}>{money(l.unit_cost)}</td>
                      <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(l.quantity) * Number(l.unit_price))}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-danger" onClick={() => lines.remove(l.id)}>Remove</button></td>
                    </>}
                  </tr>
                ))}
              </tbody>
              {canLines && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={3} />
                    <td style={{ textAlign: 'right' }} className="muted">Cost {money(totalCost)}</td>
                    <td style={{ textAlign: 'right' }} className="muted">Margin {money(margin)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{money(totalBillable)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : <p className="muted">No line items yet.</p>}
      </div>

      {/* Resolution + sign-off */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Resolution</h3>
          <textarea className="input" rows={4} placeholder="What was found and fixed…" value={resolution} disabled={!canEditSignoff} onChange={(e) => setResolution(e.target.value)} />
          {canEditSignoff && <div style={{ marginTop: 10, textAlign: 'right' }}><button className="btn btn-primary" disabled={saving} onClick={saveResolution}>Save resolution</button></div>}
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Customer sign-off</h3>
          <Field label="Signed by (printed name)"><input className="input" value={sign.signature_name} disabled={!canEditSignoff} onChange={(e) => setSign({ ...sign, signature_name: e.target.value })} /></Field>
          <div className="label">Signature</div>
          {sign.signature_url && <img src={sign.signature_url} alt="signature" loading="lazy" decoding="async" style={{ display: 'block', maxWidth: 260, marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />}
          {canEditSignoff
            ? <button type="button" className="btn" onClick={() => setSignOpen(true)}>{sign.signature_url ? 'Re-sign' : 'Add signature'}</button>
            : !sign.signature_url && <span className="muted">Not signed</span>}
          {canEditSignoff && sign.signature_name !== (wo.signature_name || '') && (
            <div style={{ marginTop: 10, textAlign: 'right' }}><button className="btn btn-primary" disabled={saving} onClick={() => saveSignoff()}>Save name</button></div>
          )}
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
        {pending.map((p) => {
          const capturedAt = p.queuedAt ? new Date(p.queuedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
          const photoSrc = p.b64 ? `data:${p.contentType};base64,${p.b64}` : '';
          return (
            <div key={`p-${p.id}`} style={{ padding: '10px 0', borderTop: '1px solid var(--border)', opacity: 0.75 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>You · <span style={{ fontWeight: 400 }}>captured {capturedAt}</span></span>
                <span className="badge badge-yellow" style={{ fontSize: 11 }}>Pending sync</span>
              </div>
              {p.type === 'upload_and_attach'
                ? <img src={photoSrc} alt="Pending upload" loading="lazy" decoding="async" style={{ marginTop: 6, maxWidth: '100%', borderRadius: 8, border: '1px dashed var(--border)' }} />
                : <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.caption}</div>}
            </div>
          );
        })}
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
        )) : !pending.length && <p className="muted">No activity yet.</p>}
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
                <NameSelect members={members} value={editForm.assignee_email} onChange={(v) => setEditForm({ ...editForm, assignee_email: v })} placeholder="— unassigned —" />
              </Field>
            </div>
            <Field label="Requested by (customer contact)"><input className="input" value={editForm.requested_by} onChange={(e) => setEditForm({ ...editForm, requested_by: e.target.value })} /></Field>
            <Field label="SLA due"><input className="input" type="datetime-local" value={editForm.sla_due} onChange={(e) => setEditForm({ ...editForm, sla_due: e.target.value })} /></Field>
            <div className="pair">
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

      {addItemOpen && (
        <Modal title="Add item" onClose={() => setAddItemOpen(false)}>
          <form onSubmit={submitAddItem}>
            <Field label="Item">
              <select className="input" required value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
                <option value="">— select an item —</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}
              </select>
            </Field>
            {canCreateItem && (
              <button type="button" className="btn" style={{ marginBottom: 14 }} onClick={() => { setAddItemOpen(false); setNewItemOpen(true); }}>+ Add new item</button>
            )}
            <Field label="Quantity"><input className="input" type="number" step="0.01" min="0.01" required value={addItemQty} onChange={(e) => setAddItemQty(e.target.value)} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setAddItemOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !addItemId}>{saving ? 'Saving…' : 'Add item'}</button>
            </div>
          </form>
        </Modal>
      )}

      {newItemOpen && (
        <Modal title="Add new item" onClose={() => { setNewItemOpen(false); setAddItemOpen(true); }}>
          <form onSubmit={submitNewItem}>
            <Field label="Name"><input className="input" required value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></Field>
            <div className="pair">
              <Field label="SKU"><input className="input" value={newItem.sku} onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })} /></Field>
              <Field label="Cost ($)"><input className="input" type="number" step="0.01" value={newItem.unit_cost} onChange={(e) => setNewItem({ ...newItem, unit_cost: e.target.value })} /></Field>
            </div>
            <Field label="Photo"><ImageInput value={newItem.image_url} onChange={({ url }) => setNewItem({ ...newItem, image_url: url })} label="photo" /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => { setNewItemOpen(false); setAddItemOpen(true); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add item'}</button>
            </div>
          </form>
        </Modal>
      )}

      {signOpen && (
        <SignaturePad
          promptText={me.org?.feature_flags?.workOrders?.signaturePrompt || 'By signing below, I confirm the work described above was completed to my satisfaction.'}
          onSave={onSignatureSaved}
          onCancel={() => setSignOpen(false)}
        />
      )}
    </>
  );
}
