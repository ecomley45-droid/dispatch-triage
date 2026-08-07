import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Modal, Field, Badge } from '../components/ui.jsx';

const OPEN = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const DAY_MS = 86_400_000;

const startOfWeek = (base) => { const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const toInput = (iso) => (iso ? new Date(iso - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
// Move a work order onto `day`, preserving its existing time-of-day (or 9am).
const onDay = (existingIso, day) => {
  const t = existingIso ? new Date(existingIso) : null;
  const d = new Date(day);
  d.setHours(t ? t.getHours() : 9, t ? t.getMinutes() : 0, 0, 0);
  return d.toISOString();
};

function Card({ wo, custName, onOpen, draggable, onDragStart }) {
  const done = wo.status === 'completed' || wo.status === 'invoiced';
  return (
    <button
      className="card"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 10, marginBottom: 8, cursor: 'pointer', opacity: done ? 0.6 : 1, borderLeft: `3px solid ${wo.priority === 'urgent' || wo.priority === 'high' ? 'var(--danger)' : wo.priority === 'medium' ? 'var(--warning)' : 'var(--border)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>{wo.number}</span>
        {wo.scheduled_start && <span className="muted" style={{ fontSize: 11 }}>{time(wo.scheduled_start)}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, margin: '2px 0' }}>{wo.title}</div>
      <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName[wo.customer_id] || '—'}</div>
      <div style={{ marginTop: 4, fontSize: 11 }}>{wo.assignee_email ? wo.assignee_email.split('@')[0] : <span className="muted">unassigned</span>}</div>
    </button>
  );
}

export default function Schedule() {
  const me = useMe();
  const nav = useNavigate();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [tech, setTech] = useState('all');
  const [edit, setEdit] = useState(null); // the WO being scheduled
  const [form, setForm] = useState({ scheduled_start: '', scheduled_end: '', assignee_email: '' });
  const [saving, setSaving] = useState(false);

  const canWO = me.can('work_orders:write');

  useEffect(() => {
    api.list('/work-orders').then(setOrders).catch(() => setOrders([]));
    api.list('/customers').then(setCustomers).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);

  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = addDays(weekStart, 7);

  const byTech = (w) => tech === 'all' || w.assignee_email === (tech === 'unassigned' ? null : tech) || (tech === 'unassigned' && !w.assignee_email);
  const visible = orders.filter((w) => w.status !== 'cancelled').filter(byTech);
  const unscheduled = visible.filter((w) => OPEN.has(w.status) && !w.scheduled_start);
  const forDay = (day) => visible
    .filter((w) => w.scheduled_start && sameDay(new Date(w.scheduled_start), day))
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

  const applyPatch = async (id, body) => {
    const updated = await api.patch(`/work-orders/${id}`, body);
    setOrders((rows) => rows.map((r) => (r.id === id ? updated : r)));
    return updated;
  };

  // Drag a card onto a day column (or the unscheduled bucket).
  const onDrop = async (day) => async (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/wo');
    if (!id || !canWO) return;
    const wo = orders.find((r) => r.id === id);
    if (!wo) return;
    if (day) {
      const body = { scheduled_start: onDay(wo.scheduled_start, day) };
      if (wo.status === 'requested') body.status = 'scheduled';
      await applyPatch(id, body);
    } else {
      const body = { scheduled_start: null, scheduled_end: null };
      if (wo.status === 'scheduled') body.status = 'requested';
      await applyPatch(id, body);
    }
  };
  const allowDrop = (e) => { if (canWO) e.preventDefault(); };

  const openEdit = (wo) => {
    setEdit(wo);
    setForm({ scheduled_start: toInput(wo.scheduled_start), scheduled_end: toInput(wo.scheduled_end), assignee_email: wo.assignee_email || '' });
  };
  const saveEdit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const body = {
        scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : null,
        scheduled_end: form.scheduled_end ? new Date(form.scheduled_end).toISOString() : null,
        assignee_email: form.assignee_email || null,
      };
      if (body.scheduled_start && edit.status === 'requested') body.status = 'scheduled';
      if (!body.scheduled_start && edit.status === 'scheduled') body.status = 'requested';
      await applyPatch(edit.id, body);
      setEdit(null);
    } finally { setSaving(false); }
  };

  const label = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <PageHeader title="Schedule" subtitle="Assign and dispatch work orders across the week"
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 'auto' }} value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="all">All techs</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
          </select>
          <button className="btn" onClick={() => setWeekStart((w) => addDays(w, -7))}>←</button>
          <button className="btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>{label}</button>
          <button className="btn" onClick={() => setWeekStart((w) => addDays(w, 7))}>→</button>
        </div>} />

      {canWO && <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>Tip: drag a card onto a day to schedule it, or click it to set a time and tech.</p>}

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
        {/* Unscheduled bucket */}
        <div onDragOver={allowDrop} onDrop={onDrop(null)}
          style={{ flex: '0 0 200px', background: 'var(--surface-2)', borderRadius: 10, padding: 10, minHeight: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Unscheduled <span className="muted">({unscheduled.length})</span></div>
          {unscheduled.map((w) => (
            <Card key={w.id} wo={w} custName={custName} draggable={canWO} onOpen={() => openEdit(w)}
              onDragStart={(e) => e.dataTransfer.setData('text/wo', w.id)} />
          ))}
          {!unscheduled.length && <div className="muted" style={{ fontSize: 12 }}>Nothing waiting.</div>}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const isToday = sameDay(day, new Date());
          const list = forDay(day);
          return (
            <div key={day.toISOString()} onDragOver={allowDrop} onDrop={onDrop(day)}
              style={{ flex: '0 0 200px', borderRadius: 10, padding: 10, minHeight: 200, border: isToday ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: isToday ? 'var(--primary)' : 'inherit' }}>
                {day.toLocaleDateString([], { weekday: 'short' })} <span className="muted">{day.getDate()}</span>
              </div>
              {list.map((w) => (
                <Card key={w.id} wo={w} custName={custName} draggable={canWO} onOpen={() => openEdit(w)}
                  onDragStart={(e) => e.dataTransfer.setData('text/wo', w.id)} />
              ))}
              {!list.length && <div className="muted" style={{ fontSize: 12 }}>—</div>}
            </div>
          );
        })}
      </div>

      {edit && (
        <Modal title={`Schedule ${edit.number}`} onClose={() => setEdit(null)}>
          <div className="muted" style={{ marginTop: -6, marginBottom: 12 }}>{edit.title} · {custName[edit.customer_id] || '—'} · <Badge value={edit.priority} /></div>
          <form onSubmit={saveEdit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Start"><input className="input" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} /></Field>
            </div>
            <Field label="Assign to">
              <select className="input" value={form.assignee_email} onChange={(e) => setForm({ ...form, assignee_email: e.target.value })}>
                <option value="">— unassigned —</option>
                {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button type="button" className="btn" onClick={() => nav(`/work-orders/${edit.id}`)}>Open work order</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
