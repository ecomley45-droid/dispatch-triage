import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, money } from '../components/ui.jsx';

function Stat({ label, value, hint }) {
  return (
    <div className="card" style={{ padding: 18, flex: '1 1 160px' }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
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
        <Stat label="Active projects" value={d ? d.stats.activeProjects : '—'} hint={d ? `${d.stats.totalProjects} total` : ' '} />
        <Stat label="Open punch items" value={d ? d.stats.openPunch : '—'} hint={d ? `${d.stats.totalPunch} total` : ' '} />
        <Stat label="Scheduled jobs" value={d ? d.stats.scheduledJobs : '—'} hint="dispatch queue" />
        <Stat label="Material cost logged" value={d ? money(d.stats.materialCost) : '—'} hint={d ? `${d.stats.usageCount} usage entries` : ' '} />
      </div>

      {!d && !error && <p className="muted">Loading…</p>}

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
