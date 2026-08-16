import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Modal, Field, Badge, useIsMobile, NameSelect } from '../components/ui.jsx';
import ShiftClock from '../components/ShiftClock.jsx';

const OPEN = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const startOfWeek = (base) => { const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const toInput = (iso) => (iso ? new Date(iso - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const onDay = (existingIso, day) => { const t = existingIso ? new Date(existingIso) : null; const d = new Date(day); d.setHours(t ? t.getHours() : 9, t ? t.getMinutes() : 0, 0, 0); return d.toISOString(); };
const isoDate = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };

const SHIFT_TYPE_LABEL = { shift: 'Shift', pto: 'PTO', sick: 'Sick', call_out: 'Call out' };
const SHIFT_TYPE_COLOR = { shift: 'var(--primary)', pto: '#7c5cff', sick: 'var(--danger)', call_out: 'var(--warning)' };

// Compact "week"/"month"/"day" picker — replaces three separate toggle
// buttons with one dropdown. "Techs" stays a standalone toggle (it's a
// different axis: per-person rows, not a time-range granularity).
function ViewDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.key === value)?.label || value;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'capitalize' }} onClick={() => setOpen((o) => !o)}>
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', minWidth: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.22)', zIndex: 71, overflow: 'hidden' }}>
            {options.map((o) => (
              <button key={o.key} onClick={() => { onChange(o.key); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: o.key === value ? 'var(--surface-2)' : 'transparent', border: 'none', padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: o.key === value ? 700 : 500, color: 'var(--text)' }}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Small pill shown under a day header: the person's planned hours for that
// date (shift/PTO/sick/call-out), plus actual worked hours once punched.
function DayHoursBadge({ planned, workedMs, canEdit, onEdit }) {
  if (!planned && !workedMs) {
    return canEdit ? <button className="btn" style={{ padding: '1px 6px', fontSize: 10.5, marginTop: 2 }} onClick={onEdit}>+ hours</button> : null;
  }
  const workedH = workedMs ? (workedMs / 3600000).toFixed(1) : null;
  return (
    <button className="btn" onClick={canEdit ? onEdit : undefined} disabled={!canEdit}
      style={{ padding: '1px 6px', fontSize: 10.5, marginTop: 2, borderColor: planned ? SHIFT_TYPE_COLOR[planned.type] : undefined, color: planned ? SHIFT_TYPE_COLOR[planned.type] : undefined, cursor: canEdit ? 'pointer' : 'default' }}>
      {planned ? `${SHIFT_TYPE_LABEL[planned.type]}${planned.hours ? ` ${planned.hours}h` : ''}` : ''}
      {workedH && <span className="muted" style={{ marginLeft: planned ? 4 : 0 }}>· worked {workedH}h</span>}
    </button>
  );
}

function Card({ wo, custName, onOpen, draggable, onDragStart }) {
  const done = wo.status === 'completed' || wo.status === 'invoiced';
  return (
    <button className="card" draggable={draggable} onDragStart={onDragStart} onClick={onOpen}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 10, marginBottom: 8, cursor: 'pointer', opacity: done ? 0.6 : 1, borderLeft: `3px solid ${wo.priority === 'urgent' || wo.priority === 'high' ? 'var(--danger)' : wo.priority === 'medium' ? 'var(--warning)' : 'var(--border)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>{wo.number}</span>
        {wo.scheduled_start && <span className="muted" style={{ fontSize: 11 }}>{time(wo.scheduled_start)}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, margin: '2px 0' }}>{wo.title}</div>
      <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName[wo.customer_id] || '—'}</div>
      {wo.assignee_email && <div style={{ fontSize: 11, marginTop: 3 }}>{wo.assignee_email.split('@')[0]}</div>}
    </button>
  );
}

// A drop zone that highlights while a card hovers. Highlight is outline-only
// (never inserts/removes DOM or changes layout) so hovering can't shift the
// element under the cursor and cause dragenter/dragleave feedback jitter.
function Zone({ id, dropId, setDropId, onDrop, canDrop, children, style }) {
  const active = dropId === id;
  const depth = useRef(0);
  return (
    <div
      onDragEnter={(e) => { if (!canDrop) return; e.preventDefault(); depth.current += 1; if (dropId !== id) setDropId(id); }}
      onDragOver={(e) => { if (canDrop) e.preventDefault(); }}
      onDragLeave={(e) => {
        if (!canDrop) return;
        depth.current -= 1;
        if (depth.current <= 0) { depth.current = 0; setDropId((d) => (d === id ? null : d)); }
      }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setDropId(null); onDrop(e); }}
      style={{ ...style, outline: active ? '2px dashed var(--primary)' : 'none', outlineOffset: -2, background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : style?.background }}>
      {children}
    </div>
  );
}

const TSR_BLANK = { target_date: '', requested_clock_in: '', requested_clock_out: '', reason: '' };

export default function Schedule() {
  const me = useMe();
  const nav = useNavigate();
  const role = me.viewer?.role;
  const isDispatcher = role === 'dispatcher';
  const isTechnician = role === 'technician';
  const canScheduleHours = me.can('shifts:schedule');

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [plannedShifts, setPlannedShifts] = useState([]); // scheduled_shifts (planned roster)
  const [workedShifts, setWorkedShifts] = useState([]); // shifts (actual clock in/out)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dayView, setDayView] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [monthDate, setMonthDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [view, setView] = useState('week'); // week | month | day | techs
  const [tech, setTech] = useState(isDispatcher || isTechnician ? me.viewer.email : 'all');
  const [dropId, setDropId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ scheduled_start: '', scheduled_end: '', assignee_email: '' });
  const [saving, setSaving] = useState(false);
  const [tsrOpen, setTsrOpen] = useState(false);
  const [tsr, setTsr] = useState(TSR_BLANK);
  const [tsrMsg, setTsrMsg] = useState(null);
  const [hoursEdit, setHoursEdit] = useState(null); // { email, date, existing }

  const canWO = me.can('work_orders:write');
  const isMobile = useIsMobile();

  useEffect(() => {
    api.list('/work-orders').then(setOrders).catch(() => setOrders([]));
    api.list('/customers').then(setCustomers).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
    api.list('/scheduled-shifts').then(setPlannedShifts).catch(() => {});
    api.get('/shifts').then(setWorkedShifts).catch(() => {});
  }, []);

  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const techs = (isDispatcher || isTechnician) ? members.filter((m) => m.user_email === me.viewer.email) : members;

  const byTech = (w) => tech === 'all' || (tech === 'unassigned' ? !w.assignee_email : w.assignee_email === tech);
  const visible = orders.filter((w) => w.status !== 'cancelled').filter(byTech);
  // Technicians don't need an "Unscheduled" pile — it's dispatch's queue to
  // triage, not something a tech acts on.
  const unscheduled = isTechnician ? [] : visible.filter((w) => OPEN.has(w.status) && !w.scheduled_start);
  const forDay = (day, list = visible) => list.filter((w) => w.scheduled_start && sameDay(new Date(w.scheduled_start), day)).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

  // planned/worked hours lookups, keyed by `${email}|${yyyy-mm-dd}`.
  const plannedByKey = useMemo(() => Object.fromEntries(plannedShifts.map((s) => [`${s.user_email}|${s.date}`, s])), [plannedShifts]);
  const workedMsByKey = useMemo(() => {
    const m = {};
    for (const s of workedShifts) {
      const key = `${s.user_email}|${isoDate(s.clock_in)}`;
      const end = s.clock_out ? new Date(s.clock_out).getTime() : Date.now();
      m[key] = (m[key] || 0) + Math.max(0, end - new Date(s.clock_in).getTime());
    }
    return m;
  }, [workedShifts]);
  const reloadPlanned = () => api.list('/scheduled-shifts').then(setPlannedShifts).catch(() => {});
  const saveHours = async (body) => {
    const existing = hoursEdit?.existing;
    if (existing) await api.patch(`/scheduled-shifts/${existing.id}`, body);
    else await api.post('/scheduled-shifts', { user_email: hoursEdit.email, date: hoursEdit.date, ...body });
    setHoursEdit(null);
    reloadPlanned();
  };
  const deleteHours = async () => {
    if (hoursEdit?.existing) await api.del(`/scheduled-shifts/${hoursEdit.existing.id}`);
    setHoursEdit(null);
    reloadPlanned();
  };

  const applyPatch = async (id, body) => { const u = await api.patch(`/work-orders/${id}`, body); setOrders((rows) => rows.map((r) => (r.id === id ? u : r))); };
  const woFromDrag = (e) => orders.find((r) => r.id === e.dataTransfer.getData('text/wo'));
  const reschedule = async (wo, { day, assignee, clear }) => {
    if (!wo || !canWO) return;
    const body = {};
    if (clear) { body.scheduled_start = null; body.scheduled_end = null; if (wo.status === 'scheduled') body.status = 'requested'; }
    else if (day) { body.scheduled_start = onDay(wo.scheduled_start, day); if (wo.status === 'requested') body.status = 'scheduled'; }
    if (assignee !== undefined) body.assignee_email = assignee || null;
    await applyPatch(wo.id, body);
  };

  const openEdit = (wo) => { setEdit(wo); setForm({ scheduled_start: toInput(wo.scheduled_start), scheduled_end: toInput(wo.scheduled_end), assignee_email: wo.assignee_email || '' }); };
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
      await applyPatch(edit.id, body); setEdit(null);
    } finally { setSaving(false); }
  };

  const submitTsr = async (e) => {
    e.preventDefault();
    try {
      await api.post('/timesheet-requests', {
        target_date: tsr.target_date || null,
        requested_clock_in: tsr.requested_clock_in ? new Date(tsr.requested_clock_in).toISOString() : null,
        requested_clock_out: tsr.requested_clock_out ? new Date(tsr.requested_clock_out).toISOString() : null,
        reason: tsr.reason,
      });
      setTsrOpen(false); setTsr(TSR_BLANK); setTsrMsg('Correction request submitted for manager approval.');
    } catch (ex) { setTsrMsg(`Failed: ${ex.message}`); }
  };

  const dragProps = (w) => ({ draggable: canWO, onDragStart: (e) => e.dataTransfer.setData('text/wo', w.id) });
  const colBase = { flex: '0 0 200px', borderRadius: 10, padding: 10, minHeight: 180 };
  // On mobile, stack days/columns vertically instead of horizontal scroll.
  const rowStyle = isMobile ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 };
  const col = isMobile ? { borderRadius: 10, padding: 10, minHeight: 56, border: '1px solid var(--border)', flexShrink: 0 } : colBase;
  // The week always has a fixed column count (7 days, +1 for Unscheduled), so
  // a grid that divides the available width fits every column on screen with
  // no horizontal scroll — unlike Day/Techs views, whose column count varies
  // with headcount and still needs to scroll.
  const weekColCount = (isTechnician ? 0 : 1) + 7;
  const weekRowStyle = isMobile ? rowStyle : { display: 'grid', gridTemplateColumns: `repeat(${weekColCount}, minmax(0, 1fr))`, gap: 10 };
  const weekCol = isMobile ? col : { ...colBase, flex: 'unset', minWidth: 0 };
  const weekLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <PageHeader title="Schedule" subtitle={isDispatcher ? 'Your shifts and work orders' : 'Assign and dispatch work orders'}
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShiftClock />
          <button className="btn" onClick={() => { setTsrMsg(null); setTsrOpen(true); }}>Fix a punch</button>
        </div>} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ViewDropdown value={view === 'techs' ? 'week' : view}
            options={[{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }]}
            onChange={setView} />
          {/* "Techs" is a different axis (per-person rows) than a time-range
              granularity, so it stays a standalone toggle — irrelevant for a
              technician, who only ever sees their own single row. */}
          {!isTechnician && (
            <button className={`btn ${view === 'techs' ? 'btn-teal' : ''}`} onClick={() => setView('techs')}>Techs</button>
          )}
        </div>
        {!isDispatcher && !isTechnician && (
          <NameSelect members={members} value={tech} onChange={setTech} style={{ width: 160 }}
            extraOptions={[{ value: 'all', label: 'All techs' }, { value: 'unassigned', label: 'Unassigned' }]} />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {view === 'month' ? (
            <>
              <button className="btn" onClick={() => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
              <button className="btn" onClick={() => { const d = new Date(); setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1)); }}>{monthDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}</button>
              <button className="btn" onClick={() => setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
            </>
          ) : view === 'day' ? (
            <>
              <button className="btn" onClick={() => setDayView((d) => addDays(d, -1))}>←</button>
              <button className="btn" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setDayView(d); }}>{dayView.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</button>
              <button className="btn" onClick={() => setDayView((d) => addDays(d, 1))}>→</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setWeekStart((w) => addDays(w, -7))}>←</button>
              <button className="btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>{weekLabel}</button>
              <button className="btn" onClick={() => setWeekStart((w) => addDays(w, 7))}>→</button>
            </>
          )}
        </div>
      </div>

      {tsrMsg && <p className="badge badge-green" style={{ marginBottom: 12 }}>{tsrMsg}</p>}
      {canWO && <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>Drag a card to reschedule; a drop zone appears where it will land.</p>}

      {/* WEEK VIEW */}
      {view === 'week' && (
        <div style={weekRowStyle}>
          {!isTechnician && (
            <Zone id="unsched" dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { clear: true })}
              style={{ ...weekCol, ...(isMobile ? {} : { flexBasis: 200 }), background: 'var(--surface-2)' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Unscheduled <span className="muted">({unscheduled.length})</span></div>
              {unscheduled.map((w) => <Card key={w.id} wo={w} custName={custName} {...dragProps(w)} onOpen={() => openEdit(w)} />)}
              {!unscheduled.length && <div className="muted" style={{ fontSize: 12 }}>Nothing waiting.</div>}
            </Zone>
          )}
          {days.map((day) => {
            const today = sameDay(day, new Date());
            // Only shown for a single-person view (self, or a manager filtered
            // to one tech) — a day column mixing many people has no one owner.
            const badgeEmail = tech !== 'all' && tech !== 'unassigned' ? tech : null;
            const dateKey = badgeEmail ? `${badgeEmail}|${isoDate(day)}` : null;
            return (
              <Zone key={day.toISOString()} id={`d${day.toISOString()}`} dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { day })}
                style={{ ...weekCol, border: today ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: today ? 'var(--primary)' : 'inherit' }}>{day.toLocaleDateString([], { weekday: 'short' })} <span className="muted">{day.getDate()}</span></div>
                {badgeEmail && (
                  <div style={{ marginBottom: 8 }}>
                    <DayHoursBadge planned={plannedByKey[dateKey]} workedMs={workedMsByKey[dateKey]} canEdit={canScheduleHours}
                      onEdit={() => setHoursEdit({ email: badgeEmail, date: isoDate(day), existing: plannedByKey[dateKey] || null })} />
                  </div>
                )}
                {!badgeEmail && <div style={{ marginBottom: 8 }} />}
                {forDay(day).map((w) => <Card key={w.id} wo={w} custName={custName} {...dragProps(w)} onOpen={() => openEdit(w)} />)}
              </Zone>
            );
          })}
        </div>
      )}

      {/* DAY VIEW — one column per tech for the selected day */}
      {view === 'day' && (
        <div style={rowStyle}>
          {!isTechnician && (
            <Zone id="unsched" dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { clear: true })} style={{ ...col, background: 'var(--surface-2)' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Unscheduled</div>
              {unscheduled.map((w) => <Card key={w.id} wo={w} custName={custName} {...dragProps(w)} onOpen={() => openEdit(w)} />)}
            </Zone>
          )}
          {techs.map((m) => {
            const dateKey = `${m.user_email}|${isoDate(dayView)}`;
            return (
              <Zone key={m.user_email} id={`t${m.user_email}`} dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { day: dayView, assignee: m.user_email })} style={{ ...col, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{m.name || m.user_email.split('@')[0]}</div>
                <div style={{ marginBottom: 8 }}>
                  <DayHoursBadge planned={plannedByKey[dateKey]} workedMs={workedMsByKey[dateKey]} canEdit={canScheduleHours}
                    onEdit={() => setHoursEdit({ email: m.user_email, date: isoDate(dayView), existing: plannedByKey[dateKey] || null })} />
                </div>
                {forDay(dayView, orders.filter((w) => w.status !== 'cancelled' && w.assignee_email === m.user_email)).map((w) => <Card key={w.id} wo={w} custName={custName} {...dragProps(w)} onOpen={() => openEdit(w)} />)}
              </Zone>
            );
          })}
        </div>
      )}

      {/* TECHS VIEW — rows per tech, 7 day cells for the week */}
      {view === 'techs' && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, 1fr)`, gap: 8, marginBottom: 6 }}>
              <div />
              {days.map((day) => <div key={day.toISOString()} style={{ fontWeight: 700, fontSize: 12, textAlign: 'center', color: sameDay(day, new Date()) ? 'var(--primary)' : 'inherit' }}>{day.toLocaleDateString([], { weekday: 'short' })} {day.getDate()}</div>)}
            </div>
            {techs.map((m) => (
              <div key={m.user_email} style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, 1fr)`, gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, alignSelf: 'start', paddingTop: 6 }}>{m.name || m.user_email.split('@')[0]}</div>
                {days.map((day) => (
                  <Zone key={day.toISOString()} id={`${m.user_email}${day.toISOString()}`} dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { day, assignee: m.user_email })} style={{ minHeight: 60, border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                    {forDay(day, orders.filter((w) => w.status !== 'cancelled' && w.assignee_email === m.user_email)).map((w) => <Card key={w.id} wo={w} custName={custName} {...dragProps(w)} onOpen={() => openEdit(w)} />)}
                  </Zone>
                ))}
              </div>
            ))}
            {!techs.length && <p className="muted">No technicians.</p>}
          </div>
        </div>
      )}

      {/* MONTH VIEW — full-month calendar grid (mobile-friendly compact cells) */}
      {view === 'month' && (() => {
        const gridStart = startOfWeek(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
        const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
        const pcolor = (p) => (p === 'urgent' || p === 'high' ? 'var(--danger)' : p === 'medium' ? 'var(--warning)' : 'var(--primary)');
        const CELL_H = isMobile ? 74 : 104;
        const MAX_CHIPS = isMobile ? 2 : 3;
        return (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 300 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="muted" style={{ textAlign: 'center', fontSize: 11, fontWeight: 700 }}>{d}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: `${CELL_H}px`, gap: 3 }}>
                {cells.map((day) => {
                  const inMonth = day.getMonth() === monthDate.getMonth();
                  const today = sameDay(day, new Date());
                  const list = forDay(day);
                  return (
                    <Zone key={day.toISOString()} id={`m${day.toISOString()}`} dropId={dropId} setDropId={setDropId} canDrop={canWO} onDrop={(e) => reschedule(woFromDrag(e), { day })}
                      style={{ height: CELL_H, overflow: 'hidden', padding: 3, borderRadius: 6, border: today ? '2px solid var(--primary)' : '1px solid var(--border)', background: inMonth ? 'var(--surface)' : 'var(--surface-2)', opacity: inMonth ? 1 : 0.55 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'right', color: today ? 'var(--primary)' : 'inherit' }}>{day.getDate()}</div>
                      {list.slice(0, MAX_CHIPS).map((w) => (
                        <button key={w.id} draggable={canWO} onDragStart={(e) => e.dataTransfer.setData('text/wo', w.id)} onClick={() => openEdit(w)}
                          title={`${w.number} · ${w.title}`}
                          style={{ display: 'block', width: '100%', textAlign: isMobile ? 'center' : 'left', border: 0, borderRadius: 4, padding: '1px 4px', marginTop: 2, fontSize: 10, fontWeight: 600, lineHeight: 1.3, color: '#fff', background: pcolor(w.priority), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                          {isMobile ? (w.number || '').replace('WO-', '#') : w.title}
                        </button>
                      ))}
                      {list.length > MAX_CHIPS && <div className="muted" style={{ fontSize: 10, marginTop: 1, textAlign: 'center' }}>+{list.length - MAX_CHIPS}</div>}
                    </Zone>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {edit && (
        <Modal title={`Schedule ${edit.number}`} onClose={() => setEdit(null)}>
          <div className="muted" style={{ marginTop: -6, marginBottom: 12 }}>{edit.title} · {custName[edit.customer_id] || '—'} · <Badge value={edit.priority} /></div>
          <form onSubmit={saveEdit}>
            <div className="pair">
              <Field label="Start"><input className="input" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} /></Field>
            </div>
            <Field label="Assign to">
              <NameSelect members={members} value={form.assignee_email} onChange={(v) => setForm({ ...form, assignee_email: v })} placeholder="— unassigned —" />
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

      {tsrOpen && (
        <Modal title="Timesheet correction" onClose={() => setTsrOpen(false)}>
          <p className="muted" style={{ marginTop: 0 }}>For a missed punch. A manager must approve before hours are added.</p>
          <form onSubmit={submitTsr}>
            <Field label="Date"><input className="input" type="date" value={tsr.target_date} onChange={(e) => setTsr({ ...tsr, target_date: e.target.value })} /></Field>
            <div className="pair">
              <Field label="Clock in"><input className="input" type="datetime-local" value={tsr.requested_clock_in} onChange={(e) => setTsr({ ...tsr, requested_clock_in: e.target.value })} /></Field>
              <Field label="Clock out"><input className="input" type="datetime-local" value={tsr.requested_clock_out} onChange={(e) => setTsr({ ...tsr, requested_clock_out: e.target.value })} /></Field>
            </div>
            <Field label="Reason"><textarea className="input" rows={2} required value={tsr.reason} onChange={(e) => setTsr({ ...tsr, reason: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setTsrOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Submit request</button>
            </div>
          </form>
        </Modal>
      )}

      {hoursEdit && (
        <HoursModal editing={hoursEdit} onSave={saveHours} onDelete={hoursEdit.existing ? deleteHours : null} onClose={() => setHoursEdit(null)} />
      )}
    </>
  );
}

function HoursModal({ editing, onSave, onDelete, onClose }) {
  const [type, setType] = useState(editing.existing?.type || 'shift');
  const [hours, setHours] = useState(editing.existing?.hours ?? '');
  const [note, setNote] = useState(editing.existing?.note || '');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await onSave({ type, hours: hours === '' ? null : Number(hours), note: note || null }); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Scheduled hours — ${new Date(editing.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(SHIFT_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
        <Field label="Hours"><input className="input" type="number" step="0.25" min="0" max="24" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" /></Field>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {onDelete ? <button type="button" className="btn btn-danger" onClick={onDelete}>Remove</button> : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
