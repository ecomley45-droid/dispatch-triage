import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, PageHeader, Badge, Modal, Field } from '../components/ui.jsx';

const STATUSES = ['open', 'pending', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// The threaded conversation for one ticket + a staff reply box.
function Thread({ ticketId, canReply, onSent }) {
  const [msgs, setMsgs] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(() => api.get(`/tickets/${ticketId}/messages`).then(setMsgs).catch(() => setMsgs([])), [ticketId]);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true); setNote(null);
    try {
      const r = await api.post(`/tickets/${ticketId}/messages`, { body: body.trim() });
      setBody(''); setNote(r.emailed ? 'Sent — customer emailed.' : 'Sent.');
      await load(); onSent?.();
    } catch (ex) { setNote(ex.message); } finally { setSending(false); }
  };

  if (!msgs) return <Loading label="Loading conversation…" />;
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
        {msgs.length ? msgs.map((m) => {
          const staff = m.author_type === 'staff';
          return (
            <div key={m.id} style={{ alignSelf: staff ? 'flex-end' : 'flex-start', maxWidth: '85%', background: staff ? 'var(--primary)' : 'var(--surface-2)', color: staff ? '#fff' : 'var(--text)', borderRadius: 12, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 2 }}>{m.author_name || (staff ? 'Staff' : 'Customer')} · {when(m.created_at)}</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.body}</div>
            </div>
          );
        }) : <p className="muted">No messages yet.</p>}
      </div>
      {canReply && (
        <form onSubmit={send} style={{ marginTop: 12 }}>
          <textarea className="input" rows={3} placeholder="Write a reply to the customer…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>{note}</span>
            <button className="btn btn-primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function TicketDetail({ ticket, canReply, onClose, onChange, onConvert }) {
  const set = async (patch) => { try { onChange(await api.patch(`/tickets/${ticket.id}`, patch)); } catch (e) { alert(e.message); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{ticket.number}</span>
          <Badge value={ticket.status} />
          <Badge value={ticket.priority} />
          {ticket.work_order_id ? (
            <Link to={`/work-orders/${ticket.work_order_id}`} style={{ fontSize: 12 }}>Work order →</Link>
          ) : (
            canReply && onConvert && <button className="btn" style={{ padding: '3px 10px', fontSize: 12 }} onClick={onConvert}>Convert to work order</button>
          )}
        </div>
        <h3 style={{ margin: '8px 0 2px' }}>{ticket.subject}</h3>
        <div className="muted" style={{ fontSize: 12 }}>Opened {when(ticket.created_at)} · by {ticket.created_by === 'portal' ? 'customer' : ticket.created_by}</div>
      </div>
      {canReply && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Status">
            <select className="input" value={ticket.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={ticket.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      )}
      <Thread ticketId={ticket.id} canReply={canReply} onSent={onClose ? undefined : undefined} />
    </div>
  );
}

// Split pane: the source ticket pinned on the left for reference while the
// work order editor (pre-filled from the ticket) is filled out on the right.
function ConvertPane({ ticket, customers, onClose, onDone }) {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({
    title: ticket.subject || '',
    description: '',
    priority: ticket.priority || 'medium',
    customer_id: ticket.customer_id || '',
    site_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!form.customer_id) { setSites([]); return; }
    api.list(`/sites?customer_id=${form.customer_id}`).then(setSites).catch(() => setSites([]));
  }, [form.customer_id]);

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null);
    try {
      const wo = await api.post('/work-orders', {
        title: form.title,
        description: form.description,
        priority: form.priority,
        customer_id: form.customer_id || null,
        site_id: form.site_id || null,
        status: 'requested',
      });
      const t = await api.patch(`/tickets/${ticket.id}`, { work_order_id: wo.id });
      onDone(t, wo);
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card modal-card" style={{ width: 'min(980px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Convert ticket to work order</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 22 }}>
          <div style={{ borderRight: '1px solid var(--border)', paddingRight: 22, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>REFERENCE — {ticket.number}</div>
            <TicketDetail ticket={ticket} canReply={false} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>NEW WORK ORDER</div>
            {err && <p className="badge badge-red" style={{ display: 'block', marginBottom: 10 }}>{err}</p>}
            <form onSubmit={submit}>
              <Field label="Title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Customer">
                  <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, site_id: '' })}>
                    <option value="">— none —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Site">
                  <select className="input" value={form.site_id} disabled={!form.customer_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
                    <option value="">— none —</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Description"><textarea className="input" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create work order'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

const BLANK = { subject: '', body: '', customer_id: '', priority: 'medium' };

export default function Tickets() {
  const me = useMe();
  const nav = useNavigate();
  const canReply = me.can('tickets:write');
  const [tickets, setTickets] = useState(null);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [converting, setConverting] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [customers, setCustomers] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api.get('/tickets').then(setTickets).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); api.list('/customers').then(setCustomers).catch(() => {}); }, [load]);

  const create = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const t = await api.post('/tickets', { subject: form.subject, body: form.body, customer_id: form.customer_id || null, priority: form.priority });
      setNewOpen(false); setForm(BLANK); await load(); setSelected(t);
    } catch (ex) { alert(ex.message); } finally { setSaving(false); }
  };

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!tickets) return <Loading label="Loading tickets…" />;

  const visible = tickets.filter((t) => !statusFilter || t.status === statusFilter);
  const custName = (id) => customers.find((c) => c.id === id)?.name || '—';

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Customer conversations from the portal"
        action={canReply && <button className="btn btn-primary" onClick={() => { setForm(BLANK); setNewOpen(true); }}>+ New ticket</button>}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{visible.length} ticket{visible.length === 1 ? '' : 's'}</span>
      </div>

      {visible.length ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {visible.map((t) => (
            <button key={t.id} onClick={() => setSelected(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', padding: '12px 16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t.number}</span>
                <Badge value={t.status} />
                <Badge value={t.priority} />
                <span style={{ fontWeight: 600 }}>{t.subject}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{when(t.last_message_at)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{custName(t.customer_id)}</div>
            </button>
          ))}
        </div>
      ) : <p className="muted">No tickets yet. Customers can start one from their portal link.</p>}

      {selected && (
        <Modal title={`Ticket ${selected.number || ''}`} onClose={() => setSelected(null)}>
          <TicketDetail ticket={selected} canReply={canReply} onChange={(t) => { setSelected(t); load(); }}
            onConvert={() => { setSelected(null); setConverting(selected); }} />
        </Modal>
      )}

      {converting && (
        <ConvertPane ticket={converting} customers={customers} onClose={() => setConverting(null)}
          onDone={(t, wo) => { setConverting(null); load(); nav(`/work-orders/${wo.id}`); }} />
      )}

      {newOpen && (
        <Modal title="New ticket" onClose={() => setNewOpen(false)}>
          <form onSubmit={create}>
            <Field label="Customer">
              <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">— none —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Subject"><input className="input" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Message (emailed to the customer if an email is on file)">
              <textarea className="input" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setNewOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create ticket'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
