import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHeader, money, useIsMobile } from '../components/ui.jsx';
import { entryDurationMs } from '../lib/calc.js';

const isoDay = (d) => d.toISOString().slice(0, 10);
const hrs = (t) => entryDurationMs(t);
const fmtH = (ms) => `${(ms / 3600000).toFixed(1)}h`;

export default function Timesheets() {
  const isMobile = useIsMobile();
  const [entries, setEntries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [services, setServices] = useState([]);
  const [members, setMembers] = useState([]);
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(isoDay(new Date()));

  useEffect(() => {
    api.get('/time-entries').then(setEntries).catch(() => {});
    api.get('/jobs').then(setJobs).catch(() => {});
    api.get('/projects').then(setProjects).catch(() => {});
    api.get('/service-offers').then(setServices).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);

  const jobById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);
  const rateById = useMemo(() => Object.fromEntries(services.map((s) => [s.id, Number(s.default_rate || 0)])), [services]);
  const projName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  const memberName = useMemo(() => Object.fromEntries(members.map((m) => [m.user_email, m.name || m.user_email])), [members]);

  // enrich + filter by date range
  const rows = useMemo(() => {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime() + 86400000; // inclusive
    return entries
      .filter((e) => { const t = new Date(e.clock_in).getTime(); return t >= start && t < end; })
      .map((e) => {
        const job = jobById[e.job_id];
        const ms = hrs(e);
        const rate = job ? rateById[job.service_offer_id] || 0 : 0;
        return { ...e, job, ms, cost: (ms / 3600000) * rate, projectName: job?.project_id ? projName[job.project_id] : '—' };
      })
      .sort((a, b) => new Date(b.clock_in) - new Date(a.clock_in));
  }, [entries, jobById, rateById, projName, from, to]);

  const groupBy = (key) => {
    const g = {};
    for (const r of rows) { const k = key(r); (g[k] ||= { ms: 0, cost: 0, n: 0 }); g[k].ms += r.ms; g[k].cost += r.cost; g[k].n++; }
    return Object.entries(g).sort((a, b) => b[1].cost - a[1].cost);
  };
  const byMember = groupBy((r) => memberName[r.user_email] || r.user_email);
  const byProject = groupBy((r) => r.projectName || '—');
  const totalMs = rows.reduce((s, r) => s + r.ms, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  const exportCsv = () => {
    const head = ['Date', 'Member', 'Job', 'Project', 'Hours', 'Rate cost', 'Open'];
    const lines = rows.map((r) => [
      new Date(r.clock_in).toLocaleString(), memberName[r.user_email] || r.user_email,
      (r.job?.title || '').replace(/,/g, ' '), (r.projectName || '').replace(/,/g, ' '),
      (r.ms / 3600000).toFixed(2), r.cost.toFixed(2), r.clock_out ? '' : 'yes',
    ].join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `timesheets_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const Summary = ({ title, data }) => (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {data.map(([name, v]) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name} <span className="muted" style={{ fontSize: 12 }}>· {v.n}</span></span>
          <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}><b>{fmtH(v.ms)}</b> <span className="muted">· {money(v.cost)}</span></span>
        </div>
      ))}
      {!data.length && <p className="muted">No time in this range.</p>}
    </div>
  );

  return (
    <>
      <PageHeader title="Timesheets" subtitle="Tracked labor hours and cost"
        action={<button className="btn" onClick={exportCsv}>Export CSV</button>} />

      <div className="card" style={{ padding: 14, marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="label" style={{ margin: 0 }}>From <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
        <label className="label" style={{ margin: 0 }}>To <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 18 }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Total hours</div><div style={{ fontSize: 20, fontWeight: 800 }}>{fmtH(totalMs)}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Labor cost</div><div style={{ fontSize: 20, fontWeight: 800 }}>{money(totalCost)}</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <Summary title="By team member" data={byMember} />
        <Summary title="By project" data={byProject} />
      </div>

      <h3>Entries</h3>
      {isMobile ? (
        <div className="m-cards">
          {rows.map((r) => (
            <div key={r.id} className="m-card" style={{ cursor: 'default' }}>
              <div className="m-card-head">
                <div><div className="m-title">{r.job?.title || '—'}</div><div className="m-meta">{memberName[r.user_email] || r.user_email} · {r.projectName}</div></div>
                <span style={{ whiteSpace: 'nowrap' }}><b>{fmtH(r.ms)}</b></span>
              </div>
              <div className="m-facts"><span>{new Date(r.clock_in).toLocaleDateString()}</span><span>Cost <b>{money(r.cost)}</b></span>{!r.clock_out && <span className="badge badge-green">on</span>}</div>
            </div>
          ))}
          {!rows.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No time entries in this range.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>Date</th><th>Member</th><th>Job</th><th>Project</th><th>Hours</th><th>Labor cost</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.clock_in).toLocaleDateString()}</td>
                  <td>{memberName[r.user_email] || r.user_email}</td>
                  <td>{r.job?.title || '—'}{!r.clock_out && <span className="badge badge-green" style={{ marginLeft: 6 }}>on</span>}</td>
                  <td className="muted">{r.projectName}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtH(r.ms)}</td>
                  <td style={{ fontWeight: 600 }}>{money(r.cost)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>No time entries in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
