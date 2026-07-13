import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, money } from '../components/ui.jsx';

function Stat({ label, value, hint }) {
  return (
    <div className="card" style={{ padding: 18, flex: '1 1 180px' }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const me = useMe();
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/projects'), api.get('/punch-items'), api.get('/jobs'),
      api.get('/items'), api.get('/item-usage'),
    ]).then(([projects, punch, jobs, items, usage]) => setD({ projects, punch, jobs, items, usage }))
      .catch(() => setD({ projects: [], punch: [], jobs: [], items: [], usage: [] }));
  }, []);

  if (!d) return <p className="muted">Loading…</p>;

  const activeProjects = d.projects.filter((p) => p.status === 'active').length;
  const openPunch = d.punch.filter((p) => p.status !== 'done').length;
  const scheduledJobs = d.jobs.filter((j) => ['scheduled', 'en_route', 'in_progress'].includes(j.status)).length;
  const totalCost = d.usage.reduce((s, u) => s + Number(u.unit_cost_at_use || 0) * Number(u.quantity || 0), 0);

  return (
    <>
      <PageHeader title={`Welcome, ${me.viewer?.name?.split(' ')[0] || ''}`} subtitle={`${me.org?.name} · operations overview`} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Active projects" value={activeProjects} hint={`${d.projects.length} total`} />
        <Stat label="Open punch items" value={openPunch} hint={`${d.punch.length} total`} />
        <Stat label="Scheduled jobs" value={scheduledJobs} hint="dispatch queue" />
        <Stat label="Material cost logged" value={money(totalCost)} hint={`${d.usage.length} usage entries`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Projects</h3>
          {d.projects.slice(0, 5).map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
              <span>{p.name}</span><Badge value={p.status} />
            </Link>
          ))}
          {!d.projects.length && <p className="muted">No projects yet.</p>}
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Upcoming jobs</h3>
          {d.jobs.slice(0, 5).map((j) => (
            <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{j.title}<div className="muted" style={{ fontSize: 12 }}>{j.location || '—'}</div></span><Badge value={j.status} />
            </div>
          ))}
          {!d.jobs.length && <p className="muted">No jobs scheduled.</p>}
        </div>
      </div>
    </>
  );
}
