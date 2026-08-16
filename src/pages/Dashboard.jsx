import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, money, Skeleton } from '../components/ui.jsx';
import AskAI from '../components/AskAI.jsx';
import ShiftClock from '../components/ShiftClock.jsx';
import JobActions from '../components/JobActions.jsx';

const OPEN_WO = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const ACTIVE = new Set(['en_route', 'on_site']);
const when = (s) => (s ? new Date(s).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'unscheduled');

// Rank the viewer's open jobs: in-progress first, then soonest scheduled.
function rankMyJobs(list) {
  return [...list].filter((w) => OPEN_WO.has(w.status)).sort((a, b) => {
    const aA = ACTIVE.has(a.status) ? 0 : 1, bA = ACTIVE.has(b.status) ? 0 : 1;
    if (aA !== bA) return aA - bA;
    return new Date(a.scheduled_start || '2999').getTime() - new Date(b.scheduled_start || '2999').getTime();
  });
}

function MyJobCard({ wo, label, onChange }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
        <Badge value={wo.status} />
      </div>
      <Link to={`/work-orders/${wo.id}`} style={{ display: 'block', fontWeight: 700, fontSize: 15, margin: '6px 0 2px', color: 'inherit', textDecoration: 'none' }}>{wo.number} · {wo.title}</Link>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{when(wo.scheduled_start)}</div>
      <JobActions wo={wo} onChange={onChange} />
    </div>
  );
}

function Stat({ label, value, hint, loading }) {
  return (
    <div className="card" style={{ padding: 18, flex: '1 1 160px' }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      {loading
        ? <Skeleton w="55%" h={26} style={{ margin: '8px 0 6px' }} />
        : <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>}
      {loading ? <Skeleton w="42%" h={11} /> : hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function ListCardSkeleton({ title }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
          <Skeleton w="55%" h={13} /><Skeleton w={60} h={20} r={999} />
        </div>
      ))}
    </div>
  );
}

const isoToday = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const PAY_PERIOD_DAYS = 14; // no configurable payroll cadence yet — approximate with a trailing 14-day window

function ShiftHoursHint({ shift }) {
  if (!shift) return null;
  const label = shift.type === 'shift' ? null : { pto: 'PTO', sick: 'Sick', call_out: 'Call out' }[shift.type];
  return (
    <span className="muted" style={{ fontSize: 12.5 }}>
      {label ? `Scheduled: ${label}` : 'Scheduled today'}{shift.hours ? ` · ${shift.hours}h` : ''}
    </span>
  );
}

export default function Dashboard() {
  const me = useMe();
  const role = me.viewer?.role;
  const isTechnician = role === 'technician';
  const isManager = role === 'manager_admin';
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [myJobs, setMyJobs] = useState([]);
  const [todayShift, setTodayShift] = useState(null);
  const [payPeriodMs, setPayPeriodMs] = useState(0);
  const [openTickets, setOpenTickets] = useState(null);
  const [regionWO, setRegionWO] = useState(null); // manager, region/team-scoped open-WO count

  useEffect(() => {
    api.get('/dashboard').then(setD).catch((e) => setError(e.message));
    if (me.viewer?.email) api.list(`/work-orders?assignee_email=${encodeURIComponent(me.viewer.email)}`).then((r) => setMyJobs(rankMyJobs(r))).catch(() => {});
  }, [me.viewer?.email]);

  // "My shift" scheduled hours for today — shown for everyone, only if set.
  useEffect(() => {
    if (!me.viewer?.email) return;
    api.list(`/scheduled-shifts?user_email=${encodeURIComponent(me.viewer.email)}&date=${isoToday()}`)
      .then((rows) => setTodayShift(rows[0] || null)).catch(() => {});
  }, [me.viewer?.email]);

  // Technician: hours worked in the trailing pay-period window, from actual clock punches.
  useEffect(() => {
    if (!isTechnician || !me.viewer?.email) return;
    api.get(`/shifts?user_email=${encodeURIComponent(me.viewer.email)}`).then((rows) => {
      const since = Date.now() - PAY_PERIOD_DAYS * 86400000;
      const ms = rows.filter((s) => new Date(s.clock_in).getTime() >= since)
        .reduce((sum, s) => sum + Math.max(0, (s.clock_out ? new Date(s.clock_out).getTime() : Date.now()) - new Date(s.clock_in).getTime()), 0);
      setPayPeriodMs(ms);
    }).catch(() => {});
  }, [isTechnician, me.viewer?.email]);

  // Manager admin: Open Tickets (replaces the Customers box), and — when the
  // manager is themselves scoped to a region/team — an open-WO count for just
  // that region/team instead of the org-wide figure from /api/dashboard.
  useEffect(() => {
    if (!isManager) return;
    api.list('/tickets').then((rows) => setOpenTickets(rows.filter((t) => t.status === 'open' || t.status === 'pending').length)).catch(() => {});
    const regionId = me.viewer?.region_id, teamId = me.viewer?.team_id;
    if (!regionId && !teamId) return;
    api.list('/work-orders').then((rows) => {
      const scoped = rows.filter((w) => (regionId ? w.region_id === regionId : true) && w.status !== 'cancelled' && OPEN_WO.has(w.status));
      setRegionWO(scoped.length);
    }).catch(() => {});
  }, [isManager, me.viewer?.region_id, me.viewer?.team_id]);

  const updateJob = (updated) => setMyJobs((list) => rankMyJobs(list.map((w) => (w.id === updated.id ? updated : w))));
  const [current, next] = myJobs;
  const restOfMyJobs = myJobs.slice(2);

  return (
    <>
      <PageHeader title={`Welcome, ${me.viewer?.name?.split(' ')[0] || ''}`} subtitle={`${me.org?.name} · operations overview`} />

      {error && <p className="badge badge-red">{error}</p>}

      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700 }}>My shift</div>
          <ShiftHoursHint shift={todayShift} />
        </div>
        <ShiftClock />
      </div>

      {(current || next) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
          {current && <MyJobCard wo={current} label="Current job" onChange={updateJob} />}
          {next && <MyJobCard wo={next} label="Next up" onChange={updateJob} />}
        </div>
      )}

      {me.features?.ai && me.can('ai:use') && (
        <div style={{ marginBottom: 20 }}><AskAI /></div>
      )}

      {isTechnician ? (
        <>
          {/* A tech's own numbers — org-wide financials/customer counts aren't their job. */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Your work orders" loading={!d} value={myJobs.length} hint="open, assigned to you" />
            <Stat label={`Hours this pay period`} loading={!d} value={(payPeriodMs / 3600000).toFixed(1)} hint={`trailing ${PAY_PERIOD_DAYS} days`} />
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Your work orders</h3>
            {restOfMyJobs.map((w) => (
              <Link key={w.id} to={`/work-orders/${w.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.number ? `${w.number} · ` : ''}{w.title}</span><Badge value={w.status} />
              </Link>
            ))}
            {!myJobs.length && <p className="muted">No work orders assigned to you.</p>}
            {myJobs.length > 0 && !restOfMyJobs.length && <p className="muted">Current/next job shown above — nothing else queued.</p>}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Open work orders" loading={!d} value={isManager && regionWO != null ? regionWO : d?.stats.openWorkOrders}
              hint={d ? (isManager && regionWO != null ? 'in your region/team' : (d.stats.overdueWorkOrders ? `${d.stats.overdueWorkOrders} overdue SLA` : `${d.stats.totalWorkOrders} total`)) : ''} />
            {isManager
              ? <Stat label="Open tickets" loading={openTickets == null} value={openTickets} hint="open + pending" />
              : <Stat label="Customers" loading={!d} value={d?.stats.customers} hint="active accounts" />}
            <Stat label="Outstanding A/R" loading={!d} value={d ? money(d.stats.outstandingAR) : ''} hint={d ? `${d.stats.openInvoices} unpaid invoice${d.stats.openInvoices === 1 ? '' : 's'}` : ''} />
            <Stat label="Material cost logged" loading={!d} value={d ? money(d.stats.materialCost) : ''} hint={d ? `${d.stats.usageCount} usage entries` : ''} />
          </div>

          {!d && !error && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              <ListCardSkeleton title="Projects" />
              <ListCardSkeleton title="Upcoming jobs" />
            </div>
          )}

          {d && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Open work orders</h3>
                {(d.openWorkOrders || []).map((w) => (
                  <Link key={w.id} to={`/work-orders/${w.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.number ? `${w.number} · ` : ''}{w.title}</span><Badge value={w.priority} />
                  </Link>
                ))}
                {!(d.openWorkOrders || []).length && <p className="muted">No open work orders.</p>}
              </div>
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upcoming jobs</h3>
                {d.upcomingJobs.map((j) => (
                  <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ minWidth: 0 }}>{j.title}<div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.location || '—'}</div></span><Badge value={j.status} />
                  </div>
                ))}
                {!d.upcomingJobs.length && <p className="muted">No jobs scheduled.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
