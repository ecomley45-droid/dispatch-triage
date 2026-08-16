import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge, date, useIsMobile, ListSkeleton, NameSelect } from '../components/ui.jsx';

const FREQ = ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'];
const BLANK = { customer_id: '', site_id: '', asset_id: '', title: '', description: '', priority: 'medium', frequency: 'quarterly', assignee_email: '', next_due: '', active: true };
const isDue = (p) => p.active !== false && p.next_due && p.next_due <= new Date().toISOString().slice(0, 10);

export default function Maintenance() {
  const me = useMe();
  const { rows, loading, error, create, update, reload } = useResource('/maintenance-plans');
  const isMobile = useIsMobile();
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [sites, setSites] = useState([]);
  const [assets, setAssets] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const canWrite = me.can('maintenance:write');

  useEffect(() => {
    api.list('/customers').then(setCustomers).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);
  useEffect(() => {
    if (!form.customer_id) { setSites([]); setAssets([]); return; }
    api.list(`/sites?customer_id=${form.customer_id}`).then(setSites).catch(() => setSites([]));
    api.list(`/assets?customer_id=${form.customer_id}`).then(setAssets).catch(() => setAssets([]));
  }, [form.customer_id]);

  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const dueCount = rows.filter(isDue).length;

  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await create({ ...form, customer_id: form.customer_id || null, site_id: form.site_id || null, asset_id: form.asset_id || null, assignee_email: form.assignee_email || null, next_due: form.next_due || null });
      setOpen(false); setForm(BLANK);
    } finally { setSaving(false); }
  };

  const runNow = async () => {
    setMsg(null);
    try {
      const r = await api.post('/maintenance/run', {});
      setMsg(r.created ? `Created ${r.created} work order${r.created === 1 ? '' : 's'} from due plans.` : 'No plans are due right now.');
      reload();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
  };

  const woAssets = assets.filter((a) => !form.site_id || a.site_id === form.site_id);

  return (
    <>
      <PageHeader title="Maintenance plans" subtitle="Recurring / preventive service that auto-creates work orders"
        action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canWrite && <button className="btn" onClick={runNow}>Generate due now{dueCount ? ` (${dueCount})` : ''}</button>}
          {canWrite && <button className="btn btn-primary" onClick={() => { setForm(BLANK); setOpen(true); }}>+ New plan</button>}
        </div>} />

      {error && <p className="badge badge-red">{error}</p>}
      {msg && <p className="badge badge-green" style={{ marginBottom: 12 }}>{msg}</p>}

      {loading ? <ListSkeleton count={4} /> : isMobile ? (
        <div className="m-cards">
          {rows.map((p) => (
            <div key={p.id} className="m-card" style={{ cursor: 'default' }}>
              <div className="m-card-head"><div><div className="m-title">{p.title}</div><div className="m-meta">{custName[p.customer_id] || '—'}</div></div><Badge value={p.active === false ? 'inactive' : 'active'} /></div>
              <div className="m-facts"><span>Every <b>{p.frequency}</b></span><span>Next <b className={isDue(p) ? 'badge badge-amber' : ''}>{date(p.next_due)}</b></span></div>
            </div>
          ))}
          {!rows.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No maintenance plans yet.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>Plan</th><th>Customer</th><th>Frequency</th><th>Next due</th><th>Assignee</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td>{custName[p.customer_id] || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.frequency}</td>
                  <td>{isDue(p) ? <span className="badge badge-amber">{date(p.next_due)} · due</span> : date(p.next_due)}</td>
                  <td>{p.assignee_email || '—'}</td>
                  <td>
                    {canWrite
                      ? <button className="btn" style={{ padding: '4px 10px' }} onClick={() => update(p.id, { active: !(p.active !== false) })}>{p.active === false ? 'Inactive' : 'Active'}</button>
                      : <Badge value={p.active === false ? 'inactive' : 'active'} />}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No maintenance plans yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="New maintenance plan" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="pair">
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
            <div className="pair">
              <Field label="Asset">
                <select className="input" value={form.asset_id} disabled={!form.customer_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
                  <option value="">— none —</option>
                  {woAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Assign to">
                <NameSelect members={members} value={form.assignee_email} onChange={(v) => setForm({ ...form, assignee_email: v })} placeholder="— unassigned —" />
              </Field>
            </div>
            <div className="pair">
              <Field label="Frequency">
                <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  {FREQ.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="First due date"><input className="input" type="date" value={form.next_due} onChange={(e) => setForm({ ...form, next_due: e.target.value })} /></Field>
            </div>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Description"><textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create plan'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
