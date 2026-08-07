import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge, date, useIsMobile, ListSkeleton } from '../components/ui.jsx';

const STATUSES = ['requested', 'scheduled', 'en_route', 'on_site', 'completed', 'invoiced', 'cancelled'];
const OPEN = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const BLANK = { title: '', description: '', priority: 'medium', status: 'requested', customer_id: '', site_id: '', asset_id: '', assignee_email: '', sla_due: '' };

// A dot flag when a still-open work order is past its SLA due time.
function SlaCell({ w }) {
  if (!w.sla_due) return <span className="muted">—</span>;
  const overdue = OPEN.has(w.status) && new Date(w.sla_due) < new Date();
  return <span className={overdue ? 'badge badge-red' : ''}>{date(w.sla_due)}{overdue ? ' · overdue' : ''}</span>;
}

export default function WorkOrders() {
  const me = useMe();
  const nav = useNavigate();
  const { rows, loading, error, create } = useResource('/work-orders');
  const isMobile = useIsMobile();
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [sites, setSites] = useState([]);
  const [assets, setAssets] = useState([]);
  const [saving, setSaving] = useState(false);
  const canWrite = me.can('work_orders:write');

  useEffect(() => {
    api.list('/customers').then(setCustomers).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);

  // Load the chosen customer's sites/assets so the WO can be pinned to a location.
  useEffect(() => {
    if (!form.customer_id) { setSites([]); setAssets([]); return; }
    api.list(`/sites?customer_id=${form.customer_id}`).then(setSites).catch(() => setSites([]));
    api.list(`/assets?customer_id=${form.customer_id}`).then(setAssets).catch(() => setAssets([]));
  }, [form.customer_id]);

  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const shown = rows.filter((w) => (filter === 'all' ? true : filter === 'open' ? OPEN.has(w.status) : w.status === filter));

  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const row = await create({
        ...form,
        customer_id: form.customer_id || null,
        site_id: form.site_id || null,
        asset_id: form.asset_id || null,
        assignee_email: form.assignee_email || null,
        sla_due: form.sla_due ? new Date(form.sla_due).toISOString() : null,
      });
      setOpen(false); setForm(BLANK);
      nav(`/work-orders/${row.id}`);
    } finally { setSaving(false); }
  };

  const woAssets = assets.filter((a) => !form.site_id || a.site_id === form.site_id);

  return (
    <>
      <PageHeader title="Work orders" subtitle="Service jobs across all customers"
        action={canWrite && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New work order</button>} />

      {error && <p className="badge badge-red">{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {['open', 'all', ...STATUSES].map((f) => (
          <button key={f} className={`btn ${filter === f ? 'btn-teal' : ''}`} onClick={() => setFilter(f)}>
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? <ListSkeleton count={5} /> : isMobile ? (
        <div className="m-cards">
          {shown.map((w) => (
            <button key={w.id} className="m-card" onClick={() => nav(`/work-orders/${w.id}`)}>
              <div className="m-card-head">
                <div>
                  <div className="m-title">{w.number} · {w.title}</div>
                  <div className="m-meta">{custName[w.customer_id] || '—'}</div>
                </div>
                <Badge value={w.status} />
              </div>
              <div className="m-facts">
                <span>Priority <b>{w.priority}</b></span>
                <span>SLA <b>{date(w.sla_due)}</b></span>
              </div>
            </button>
          ))}
          {!shown.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No work orders.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>#</th><th>Title</th><th>Customer</th><th>Priority</th><th>Status</th><th>Assignee</th><th>SLA due</th></tr></thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/work-orders/${w.id}`)}>
                  <td style={{ fontWeight: 700 }}>{w.number || '—'}</td>
                  <td>{w.title}</td>
                  <td>{custName[w.customer_id] || '—'}</td>
                  <td><Badge value={w.priority} /></td>
                  <td><Badge value={w.status} /></td>
                  <td>{w.assignee_email || '—'}</td>
                  <td><SlaCell w={w} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>No work orders.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="New work order" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Customer">
                <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, site_id: '', asset_id: '' })}>
                  <option value="">— none —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Site">
                <select className="input" value={form.site_id} disabled={!form.customer_id} onChange={(e) => setForm({ ...form, site_id: e.target.value, asset_id: '' })}>
                  <option value="">— none —</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Asset">
                <select className="input" value={form.asset_id} disabled={!form.customer_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
                  <option value="">— none —</option>
                  {woAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Assign to">
                <select className="input" value={form.assignee_email} onChange={(e) => setForm({ ...form, assignee_email: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="SLA due"><input className="input" type="datetime-local" value={form.sla_due} onChange={(e) => setForm({ ...form, sla_due: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create work order'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
