import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge, useIsMobile } from '../components/ui.jsx';

const BLANK = { title: '', location: '', project_id: '', service_offer_id: '', status: 'unscheduled', scheduled_start: '', assignee_email: '', notes: '' };
const STATUSES = ['unscheduled', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled'];
const dt = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function Dispatch() {
  const me = useMe();
  const { rows, create, update } = useResource('/jobs');
  const [projects, setProjects] = useState([]);
  const [services, setServices] = useState([]);
  const [members, setMembers] = useState([]);
  const [times, setTimes] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const canWrite = me.can('jobs:write');
  const canTime = me.can('time:write');
  const isMobile = useIsMobile();

  const loadTimes = () => api.get('/time-entries').then(setTimes).catch(() => setTimes([]));
  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
    api.get('/service-offers').then(setServices).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
    loadTimes();
  }, []);

  const entriesFor = (jobId) => times.filter((t) => t.job_id === jobId);
  const totalMs = (jobId) => entriesFor(jobId).reduce((s, t) => s + ((t.clock_out ? new Date(t.clock_out) : new Date()) - new Date(t.clock_in)), 0);
  const myOpenEntry = (jobId) => entriesFor(jobId).find((t) => !t.clock_out && t.user_email === me.viewer?.email);

  const clockIn = async (job) => {
    await api.post('/time-entries', { job_id: job.id, clock_in: new Date().toISOString() });
    loadTimes();
  };
  const clockOut = async (entry) => {
    await api.patch(`/time-entries/${entry.id}`, { clock_out: new Date().toISOString() });
    loadTimes();
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form };
    for (const k of ['project_id', 'service_offer_id', 'assignee_email', 'scheduled_start']) if (!payload[k]) delete payload[k];
    await create(payload);
    setOpen(false); setForm(BLANK);
  };

  const setStatus = (job, status) => update(job.id, { status });

  return (
    <>
      <PageHeader title="Dispatch & Time" subtitle="Schedule jobs by location and service, track status"
        action={canWrite && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New job</button>} />

      {isMobile ? (
        <div className="m-cards">
          {rows.map((j) => {
            const openEntry = myOpenEntry(j.id);
            const ms = totalMs(j.id);
            return (
              <div key={j.id} className="m-card" style={{ cursor: 'default' }}>
                <div className="m-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="m-title">{j.title}</div>
                    <div className="m-meta">{j.location || '—'}{j.scheduled_start ? ` · ${dt(j.scheduled_start)}` : ''}</div>
                    <div className="m-meta">{j.assignee_email || 'Unassigned'}</div>
                  </div>
                  {canWrite ? (
                    <select className="input" style={{ width: 128, flexShrink: 0 }} value={j.status} onChange={(e) => setStatus(j, e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  ) : <Badge value={j.status} />}
                </div>
                <div className="m-facts" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>Time <b>{fmtDur(ms)}</b>{openEntry && <span className="badge badge-green" style={{ marginLeft: 6 }}>on</span>}</span>
                  {canTime && (openEntry
                    ? <button className="btn btn-danger" style={{ padding: '6px 14px' }} onClick={() => clockOut(openEntry)}>Clock out</button>
                    : <button className="btn btn-teal" style={{ padding: '6px 14px' }} onClick={() => clockIn(j)}>Clock in</button>)}
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No jobs yet.</div>}
        </div>
      ) : (
      <div className="card">
        <table className="data">
          <thead><tr><th>Job</th><th>Location</th><th>Scheduled</th><th>Assignee</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            {rows.map((j) => {
              const openEntry = myOpenEntry(j.id);
              const ms = totalMs(j.id);
              return (
              <tr key={j.id}>
                <td style={{ fontWeight: 600 }}>{j.title}{j.notes && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{j.notes}</div>}</td>
                <td>{j.location || '—'}</td>
                <td>{dt(j.scheduled_start)}</td>
                <td className="muted">{j.assignee_email || 'Unassigned'}</td>
                <td>
                  {canWrite ? (
                    <select className="input" style={{ width: 140 }} value={j.status} onChange={(e) => setStatus(j, e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  ) : <Badge value={j.status} />}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 52 }}>
                      {fmtDur(ms)}{openEntry && <span className="badge badge-green" style={{ marginLeft: 6 }}>on</span>}
                    </span>
                    {canTime && (openEntry
                      ? <button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => clockOut(openEntry)}>Clock out</button>
                      : <button className="btn btn-teal" style={{ padding: '4px 10px' }} onClick={() => clockIn(j)}>Clock in</button>)}
                  </div>
                </td>
              </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No jobs yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {open && (
        <Modal title="New job" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Job title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Project">
                <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                  <option value="">— none —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Service offer">
                <select className="input" value={form.service_offer_id} onChange={(e) => setForm({ ...form, service_offer_id: e.target.value })}>
                  <option value="">— none —</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Scheduled start"><input className="input" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></Field>
              <Field label="Assignee">
                <select className="input" value={form.assignee_email} onChange={(e) => setForm({ ...form, assignee_email: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create job</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
