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

export default function Dashboard() {
  const me = useMe();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [myJobs, setMyJobs] = useState([]);

  useEffect(() => {
    api.get('/dashboard').then(setD).catch((e) => setError(e.message));
    if (me.viewer?.email) api.list(`/work-orders?assignee_email=${encodeURIComponent(me.viewer.email)}`).then((r) => setMyJobs(rankMyJobs(r))).catch(() => {});
  }, [me.viewer?.email]);

  const updateJob = (updated) => setMyJobs((list) => rankMyJobs(list.map((w) => (w.id === updated.id ? updated : w))));
  const [current, next] = myJobs;

  return (
    <>
      <PageHeader title={`Welcome, ${me.viewer?.name?.split(' ')[0] || ''}`} subtitle={`${me.org?.name} · operations overview`} />

      {error && <p className="badge badge-red">{error}</p>}

      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>My shift</div>
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

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Open work orders" loading={!d} value={d?.stats.openWorkOrders}
          hint={d ? (d.stats.overdueWorkOrders ? `${d.stats.overdueWorkOrders} overdue SLA` : `${d.stats.totalWorkOrders} total`) : ''} />
        <Stat label="Customers" loading={!d} value={d?.stats.customers} hint="active accounts" />
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
  );
}
