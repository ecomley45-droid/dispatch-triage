import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, Modal, Field, money } from '../components/ui.jsx';
import ImageInput from '../components/ImageInput.jsx';

const STATUSES = ['unscheduled', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled'];
const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const hrs = (t) => ((t.clock_out ? new Date(t.clock_out) : new Date()) - new Date(t.clock_in)) / 3600000;

export default function JobDetail() {
  const { id } = useParams();
  const me = useMe();
  const [job, setJob] = useState(null);
  const [feed, setFeed] = useState([]);
  const [usage, setUsage] = useState([]);
  const [times, setTimes] = useState([]);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [services, setServices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [note, setNote] = useState('');
  const [useForm, setUseForm] = useState({ item_id: '', quantity: 1 });
  const [edit, setEdit] = useState(null);

  const canJobs = me.can('jobs:write');
  const canPost = me.can('attachments:write');
  const canTime = me.can('time:write');
  const canUsage = me.can('usage:write');

  const loadFeed = () => api.get(`/attachments?entity_type=job&entity_id=${id}`).then(setFeed).catch(() => setFeed([]));
  const loadUsage = () => api.get(`/item-usage?job_id=${id}`).then(setUsage).catch(() => setUsage([]));
  const loadTimes = () => api.get(`/time-entries?job_id=${id}`).then(setTimes).catch(() => setTimes([]));

  useEffect(() => {
    api.get(`/jobs/${id}`).then(setJob).catch(() => setJob(null));
    loadFeed(); loadUsage(); loadTimes();
    api.get('/items').then(setItems).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
    api.get('/service-offers').then(setServices).catch(() => {});
    api.get('/projects').then(setProjects).catch(() => {});
  }, [id]);

  if (!job) return <p className="muted">Loading job…</p>;

  const setStatus = async (status) => setJob(await api.patch(`/jobs/${id}`, { status }));

  const postNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    await api.post('/attachments', { entity_type: 'job', entity_id: id, kind: 'note', url: '', caption: note.trim() });
    setNote(''); loadFeed();
  };
  const postPhoto = async (url) => {
    if (!url) return;
    await api.post('/attachments', { entity_type: 'job', entity_id: id, kind: 'photo', url, caption: '' });
    loadFeed();
  };
  const addUsage = async (e) => {
    e.preventDefault();
    const item = items.find((i) => i.id === useForm.item_id);
    if (!item) return;
    await api.post('/item-usage', { item_id: item.id, job_id: id, project_id: job.project_id || undefined, quantity: Number(useForm.quantity), unit_cost_at_use: Number(item.unit_cost) });
    setUseForm({ item_id: '', quantity: 1 }); loadUsage();
  };

  const myOpen = times.find((t) => !t.clock_out && t.user_email === me.viewer?.email);
  const clockIn = async () => { await api.post('/time-entries', { job_id: id, clock_in: new Date().toISOString() }); loadTimes(); };
  const clockOut = async () => { await api.patch(`/time-entries/${myOpen.id}`, { clock_out: new Date().toISOString() }); loadTimes(); };
  const totalHrs = times.reduce((s, t) => s + hrs(t), 0);
  const materialCost = usage.reduce((s, u) => s + Number(u.quantity) * Number(u.unit_cost_at_use), 0);
  const itemName = (uid) => items.find((i) => i.id === uid)?.name || 'Item';

  return (
    <>
      <Link to="/dispatch" className="muted" style={{ fontSize: 13, textDecoration: 'none' }}>← Dispatch</Link>
      <PageHeader title={job.title} subtitle={`${job.location || 'No location'}${job.scheduled_start ? ` · ${when(job.scheduled_start)}` : ''}`}
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canJobs ? (
            <select className="input" style={{ width: 150 }} value={job.status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          ) : <Badge value={job.status} />}
          {canJobs && <button className="btn" onClick={() => setEdit({ title: job.title, location: job.location || '', scheduled_start: job.scheduled_start ? job.scheduled_start.slice(0, 16) : '', assignee_email: job.assignee_email || '', service_offer_id: job.service_offer_id || '', project_id: job.project_id || '', notes: job.notes || '' })}>Edit</button>}
        </div>} />

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ padding: 14, flex: '1 1 130px' }}><div className="muted" style={{ fontSize: 12 }}>Assignee</div><div style={{ fontWeight: 600 }}>{job.assignee_email || 'Unassigned'}</div></div>
        <div className="card" style={{ padding: 14, flex: '1 1 130px' }}><div className="muted" style={{ fontSize: 12 }}>Time logged</div><div style={{ fontWeight: 600 }}>{totalHrs.toFixed(1)}h</div></div>
        <div className="card" style={{ padding: 14, flex: '1 1 130px' }}><div className="muted" style={{ fontSize: 12 }}>Material cost</div><div style={{ fontWeight: 600 }}>{money(materialCost)}</div></div>
        {canTime && <div className="card" style={{ padding: 14, flex: '1 1 130px', display: 'flex', alignItems: 'center' }}>
          {myOpen ? <button className="btn btn-danger" onClick={clockOut} style={{ width: '100%' }}>Clock out</button> : <button className="btn btn-teal" onClick={clockIn} style={{ width: '100%' }}>Clock in</button>}
        </div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Activity: photos + timestamped notes */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Activity</h3>
          {canPost && (
            <form onSubmit={postNote} style={{ marginBottom: 14 }}>
              <textarea className="input" rows={2} placeholder="Add a note for the team…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                <ImageInput value="" onChange={postPhoto} label="photo" />
                <button className="btn btn-primary" type="submit" disabled={!note.trim()}>Post note</button>
              </div>
            </form>
          )}
          {feed.map((a) => (
            <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{a.created_by || 'Someone'}</span>
                <span className="muted" style={{ fontSize: 12 }}>{when(a.created_at)}</span>
              </div>
              {a.kind === 'photo'
                ? <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="" style={{ marginTop: 6, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} /></a>
                : <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.caption}</div>}
            </div>
          ))}
          {!feed.length && <p className="muted">No activity yet. Post the first update.</p>}
        </div>

        {/* Items + time */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Items used <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {money(materialCost)}</span></h3>
            {canUsage && (
              <form onSubmit={addUsage} style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '1 1 140px' }} required value={useForm.item_id} onChange={(e) => setUseForm({ ...useForm, item_id: e.target.value })}>
                  <option value="">Select item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({money(i.unit_cost)}/{i.unit})</option>)}
                </select>
                <input className="input" type="number" min="0" step="0.01" style={{ width: 80 }} value={useForm.quantity} onChange={(e) => setUseForm({ ...useForm, quantity: e.target.value })} />
                <button className="btn btn-primary" type="submit">Add</button>
              </form>
            )}
            {usage.map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                <span>{itemName(u.item_id)} <span className="muted">× {u.quantity}</span></span>
                <b>{money(Number(u.quantity) * Number(u.unit_cost_at_use))}</b>
              </div>
            ))}
            {!usage.length && <p className="muted">No items logged.</p>}
          </div>

          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Time <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {totalHrs.toFixed(1)}h</span></h3>
            {times.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                <span>{t.user_email}<div className="muted" style={{ fontSize: 12 }}>{when(t.clock_in)} → {t.clock_out ? when(t.clock_out) : 'now'}</div></span>
                <b>{hrs(t).toFixed(1)}h{!t.clock_out && <span className="badge badge-green" style={{ marginLeft: 6 }}>on</span>}</b>
              </div>
            ))}
            {!times.length && <p className="muted">No time logged.</p>}
          </div>
        </div>
      </div>

      {edit && (
        <Modal title="Edit job" onClose={() => setEdit(null)}>
          <form onSubmit={async (e) => { e.preventDefault(); const payload = { ...edit }; for (const k of ['scheduled_start', 'assignee_email', 'service_offer_id', 'project_id']) if (!payload[k]) payload[k] = null; setJob(await api.patch(`/jobs/${id}`, payload)); setEdit(null); }}>
            <Field label="Title"><input className="input" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Location"><input className="input" value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Scheduled start"><input className="input" type="datetime-local" value={edit.scheduled_start} onChange={(e) => setEdit({ ...edit, scheduled_start: e.target.value })} /></Field>
              <Field label="Assignee">
                <select className="input" value={edit.assignee_email} onChange={(e) => setEdit({ ...edit, assignee_email: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {members.map((m) => <option key={m.user_email} value={m.user_email}>{m.name || m.user_email}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Project">
                <select className="input" value={edit.project_id} onChange={(e) => setEdit({ ...edit, project_id: e.target.value })}>
                  <option value="">— none —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Service offer">
                <select className="input" value={edit.service_offer_id} onChange={(e) => setEdit({ ...edit, service_offer_id: e.target.value })}>
                  <option value="">— none —</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Notes"><textarea className="input" rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
