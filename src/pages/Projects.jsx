import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge, money, date, useIsMobile } from '../components/ui.jsx';

const BLANK = { name: '', client_name: '', location: '', status: 'planning', budget: '', start_date: '', due_date: '', description: '' };

export default function Projects() {
  const me = useMe();
  const nav = useNavigate();
  const { rows, loading, error, create } = useResource('/projects');
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const canWrite = me.can('projects:write');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, budget: form.budget === '' ? null : Number(form.budget) };
      await create(payload);
      setOpen(false); setForm(BLANK);
    } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="Projects" subtitle="Large project management"
        action={canWrite && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New project</button>} />

      {error && <p className="badge badge-red">{error}</p>}

      {isMobile ? (
        <div className="m-cards">
          {rows.map((p) => (
            <button key={p.id} className="m-card" onClick={() => nav(`/projects/${p.id}`)}>
              <div className="m-card-head">
                <div>
                  <div className="m-title">{p.name}</div>
                  <div className="m-meta">{[p.client_name, p.location].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <Badge value={p.status} />
              </div>
              <div className="m-facts">
                <span>Budget <b>{money(p.budget)}</b></span>
                <span>Due <b>{date(p.due_date)}</b></span>
              </div>
            </button>
          ))}
          {!loading && !rows.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No projects yet.</div>}
        </div>
      ) : (
      <div className="card">
        <table className="data">
          <thead><tr><th>Name</th><th>Client</th><th>Location</th><th>Status</th><th>Budget</th><th>Due</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/projects/${p.id}`)}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td>{p.client_name || '—'}</td>
                <td>{p.location || '—'}</td>
                <td><Badge value={p.status} /></td>
                <td>{money(p.budget)}</td>
                <td>{date(p.due_date)}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No projects yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {open && (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Project name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Client"><input className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
              <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {['planning', 'active', 'on_hold', 'completed', 'archived'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </Field>
              <Field label="Budget ($)"><input className="input" type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
              <Field label="Due date"><input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create project'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
