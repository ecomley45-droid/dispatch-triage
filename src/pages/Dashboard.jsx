import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, money, Skeleton } from '../components/ui.jsx';

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

  useEffect(() => {
    api.get('/dashboard').then(setD).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title={`Welcome, ${me.viewer?.name?.split(' ')[0] || ''}`} subtitle={`${me.org?.name} · operations overview`} />

      {error && <p className="badge badge-red">{error}</p>}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Active projects" loading={!d} value={d?.stats.activeProjects} hint={d ? `${d.stats.totalProjects} total` : ''} />
        <Stat label="Open punch items" loading={!d} value={d?.stats.openPunch} hint={d ? `${d.stats.totalPunch} total` : ''} />
        <Stat label="Scheduled jobs" loading={!d} value={d?.stats.scheduledJobs} hint="dispatch queue" />
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
            <h3 style={{ marginTop: 0 }}>Projects</h3>
            {d.recentProjects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span><Badge value={p.status} />
              </Link>
            ))}
            {!d.recentProjects.length && <p className="muted">No projects yet.</p>}
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
