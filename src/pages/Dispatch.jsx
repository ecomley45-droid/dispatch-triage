import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge } from '../components/ui.jsx';

const BLANK = { title: '', location: '', project_id: '', service_offer_id: '', status: 'unscheduled', scheduled_start: '', assignee_email: '', notes: '' };
const STATUSES = ['unscheduled', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled'];
const dt = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function Dispatch() {
  const me = useMe();
  const { rows, create, update } = useResource('/jobs');
  const [projects, setProjects] = useState([]);
  const [services, setServices] = useState([]);
  const [members, setMembers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const canWrite = me.can('jobs:write');

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
    api.get('/service-offers').then(setServices).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);

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

      <div className="card">
        <table className="data">
          <thead><tr><th>Job</th><th>Location</th><th>Scheduled</th><th>Assignee</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((j) => (
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
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No jobs yet.</td></tr>}
          </tbody>
        </table>
      </div>

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
