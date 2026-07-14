import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, money, date } from '../components/ui.jsx';
import ImageInput from '../components/ImageInput.jsx';
import { projectPnl } from '../lib/calc.js';

const NEXT_STATUS = { open: 'in_progress', in_progress: 'done', blocked: 'in_progress', done: 'open' };

function PL({ label, value, sub, strong, tone }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'ok' ? 'var(--brand-green-text)' : 'var(--text)';
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: strong ? 20 : 18, fontWeight: strong ? 800 : 600, color }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const me = useMe();
  const [project, setProject] = useState(null);
  const [punch, setPunch] = useState([]);
  const [usage, setUsage] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [times, setTimes] = useState([]);
  const [services, setServices] = useState([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [photo, setPhoto] = useState('');
  const canWrite = me.can('punch:write');

  const loadPunch = () => api.get(`/punch-items?project_id=${id}`).then(setPunch).catch(() => setPunch([]));

  useEffect(() => {
    api.get(`/projects/${id}`).then(setProject).catch(() => setProject(null));
    loadPunch();
    api.get(`/item-usage?project_id=${id}`).then(setUsage).catch(() => setUsage([]));
    api.get(`/jobs?project_id=${id}`).then(setJobs).catch(() => setJobs([]));
    api.get('/time-entries').then(setTimes).catch(() => setTimes([]));
    api.get('/service-offers').then(setServices).catch(() => setServices([]));
  }, [id]);

  // --- P&L rollup (see src/lib/calc.js + tests/calc.test.js) ---
  const rateFor = (svcId) => Number(services.find((s) => s.id === svcId)?.default_rate || 0);
  const { material: materialCost, laborCost, laborHours, totalCost, budget, remaining } =
    projectPnl({ budget: project?.budget, usage, jobs, times, rateFor });

  const addPunch = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const row = await api.post('/punch-items', { project_id: id, title, priority, status: 'open', photo_url: photo || null });
    setPunch((p) => [row, ...p]);
    setTitle(''); setPriority('medium'); setPhoto('');
  };

  const cycleStatus = async (item) => {
    const status = NEXT_STATUS[item.status] || 'open';
    const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
    const row = await api.patch(`/punch-items/${item.id}`, patch);
    setPunch((p) => p.map((x) => (x.id === item.id ? row : x)));
  };

  if (!project) return <p className="muted">Loading project…</p>;
  const openCount = punch.filter((p) => p.status !== 'done').length;

  return (
    <>
      <Link to="/projects" className="muted" style={{ fontSize: 13, textDecoration: 'none' }}>← All projects</Link>
      <PageHeader title={project.name} subtitle={`${project.client_name || 'No client'} · ${project.location || 'No location'}`}
        action={<Badge value={project.status} />} />

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <div className="card" style={{ padding: 16, flex: '1 1 150px' }}><div className="muted" style={{ fontSize: 12 }}>Budget</div><div style={{ fontSize: 20, fontWeight: 700 }}>{money(project.budget)}</div></div>
        <div className="card" style={{ padding: 16, flex: '1 1 150px' }}><div className="muted" style={{ fontSize: 12 }}>Due</div><div style={{ fontSize: 20, fontWeight: 700 }}>{date(project.due_date)}</div></div>
        <div className="card" style={{ padding: 16, flex: '1 1 150px' }}><div className="muted" style={{ fontSize: 12 }}>Open punch items</div><div style={{ fontSize: 20, fontWeight: 700 }}>{openCount}</div></div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Financials <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· budget vs. actual</span></h3>
          <span className={`badge ${remaining >= 0 ? 'badge-green' : 'badge-red'}`}>{remaining >= 0 ? `${money(remaining)} under budget` : `${money(-remaining)} over budget`}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 14 }}>
          <PL label="Budget" value={money(budget)} />
          <PL label="Materials" value={money(materialCost)} sub={`${usage.length} entries`} />
          <PL label={`Labor (${laborHours.toFixed(1)}h)`} value={money(laborCost)} sub={`${jobs.length} jobs`} />
          <PL label="Total cost" value={money(totalCost)} strong />
          <PL label="Remaining" value={money(remaining)} tone={remaining >= 0 ? 'ok' : 'bad'} strong />
        </div>
        {budget > 0 && (
          <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (totalCost / budget) * 100)}%`, background: totalCost > budget ? 'var(--danger)' : 'var(--brand-green)', transition: 'width .3s' }} />
          </div>
        )}
      </div>

      {project.description && <div className="card" style={{ padding: 16, marginBottom: 22 }}><div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Description</div>{project.description}</div>}

      <h3>Punch sheet</h3>
      {canWrite && (
        <form onSubmit={addPunch} className="card" style={{ padding: 12, display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" placeholder="Add a punch item…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: '1 1 240px' }} />
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 130 }}>
            {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <ImageInput value={photo} onChange={setPhoto} label="photo" />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
      )}

      <div className="card">
        <table className="data">
          <thead><tr><th>Item</th><th>Priority</th><th>Assignee</th><th>Status</th></tr></thead>
          <tbody>
            {punch.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {item.photo_url && (
                      <a href={item.photo_url} target="_blank" rel="noreferrer" title="Open photo">
                        <img src={item.photo_url} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                      </a>
                    )}
                    {item.title}
                  </div>
                </td>
                <td><Badge value={item.priority} /></td>
                <td className="muted">{item.assignee_email || 'Unassigned'}</td>
                <td>
                  <button className="btn" disabled={!canWrite} onClick={() => cycleStatus(item)} title="Click to advance status" style={{ padding: '4px 8px' }}>
                    <Badge value={item.status} />
                  </button>
                </td>
              </tr>
            ))}
            {!punch.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 28 }}>No punch items yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
