import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Loading } from '../../components/ui.jsx';
import Markdown from '../../components/Markdown.jsx';

const TYPES = [
  { key: 'release_note', label: 'Release note' },
  { key: 'announcement', label: 'Announcement' },
  { key: 'maintenance', label: 'Maintenance' },
];
const STATUS_COLOR = { draft: 'var(--text-muted)', scheduled: '#cf8a12', published: '#5f9e1f' };

const emptyDraft = { title: '', body: '', type: 'announcement', version: '', force_cache_clear: false, scheduled_at: '' };

// toDatetimeLocal / fromDatetimeLocal: <input type="datetime-local"> works in
// the browser's local time with no timezone suffix; the server stores/compares
// real UTC timestamps. Converting through Date keeps those two honest.
const toDatetimeLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function StatusBadge({ status }) {
  return <span className="badge" style={{ color: STATUS_COLOR[status], background: 'var(--surface-2)' }}>{status}</span>;
}

function Editor({ draft, setDraft, onCancel, onSave, saving }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Field label="Title"><input className="input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></Field>
        <Field label="Type">
          <select className="input" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Version (optional)"><input className="input" placeholder="e.g. 2.4.0" value={draft.version} onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))} /></Field>
      </div>

      <Field label={`Body (Markdown) ${preview ? '' : ''}`}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <button type="button" className={`btn ${!preview ? 'btn-teal' : ''}`} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className={`btn ${preview ? 'btn-teal' : ''}`} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setPreview(true)}>Preview</button>
        </div>
        {preview
          ? <div className="card" style={{ padding: 14, background: 'var(--surface-2)', minHeight: 160 }}><Markdown text={draft.body} /></div>
          : <textarea className="input" rows={10} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} placeholder="## What changed&#10;&#10;- Fixed…&#10;- Added…" />}
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="Schedule for later (optional — leave blank to save as a draft)">
          <input type="datetime-local" className="input" value={draft.scheduled_at} onChange={(e) => setDraft((d) => ({ ...d, scheduled_at: e.target.value }))} />
        </Field>
        <Field label="Force cache clear">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 34 }}>
            <input type="checkbox" checked={draft.force_cache_clear} onChange={(e) => setDraft((d) => ({ ...d, force_cache_clear: e.target.checked }))} />
            Also force a full page reload on every client when this publishes
          </label>
        </Field>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Publishing always clears every client's local cache so fresh data loads on next read. This checkbox additionally forces a hard reload — reserve it for breaking changes, not routine updates.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={saving || !draft.title.trim() || !draft.body.trim()} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Announcements() {
  const [items, setItems] = useState(null);
  const [queue, setQueue] = useState([]);
  const [editingId, setEditingId] = useState(null); // 'new' | id | null
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const load = () => {
    api.get('/super/announcements').then(setItems).catch((e) => setErr(e.message));
    api.get('/super/announcements/queue').then(setQueue).catch(() => {});
  };
  useEffect(load, []);

  const startNew = () => { setDraft(emptyDraft); setEditingId('new'); };
  const startEdit = (a) => { setDraft({ title: a.title, body: a.body, type: a.type, version: a.version || '', force_cache_clear: a.force_cache_clear, scheduled_at: toDatetimeLocal(a.scheduled_at) }); setEditingId(a.id); };
  const cancel = () => { setEditingId(null); setDraft(emptyDraft); };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const payload = { ...draft, version: draft.version || null, scheduled_at: draft.scheduled_at ? new Date(draft.scheduled_at).toISOString() : null };
      if (editingId === 'new') await api.post('/super/announcements', payload);
      else await api.patch(`/super/announcements/${editingId}`, payload);
      cancel();
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const publish = async (id) => {
    if (!confirm('Publish this now? It becomes visible to users immediately (staggered by role over the next ~45 minutes), and can\'t be edited or deleted afterward.')) return;
    try { await api.post(`/super/announcements/${id}/publish`, {}); load(); } catch (e) { alert(e.message); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this draft/scheduled announcement?')) return;
    try { await api.del(`/super/announcements/${id}`); load(); } catch (e) { alert(e.message); }
  };

  if (!items) return <Loading label="Loading announcements…" />;

  const draftsAndScheduled = items.filter((a) => a.status !== 'published');
  const published = items.filter((a) => a.status === 'published');

  return (
    <div>
      <PageHeader title="Announcements" subtitle="Release notes and app-wide announcements, delivered to every workspace." action={editingId ? null : <button className="btn btn-primary" onClick={startNew}>New announcement</button>} />
      {err && <p className="badge badge-red" style={{ marginBottom: 14 }}>{err}</p>}

      {editingId && <Editor draft={draft} setDraft={setDraft} onCancel={cancel} onSave={save} saving={saving} />}

      {queue.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Scheduled queue</h3>
          {queue.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong style={{ fontSize: 13.5 }}>{a.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>Sends {new Date(a.scheduled_at).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => startEdit(a)}>Edit</button>
                <button className="btn btn-teal" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => publish(a.id)}>Publish now</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Drafts</h3>
        {!draftsAndScheduled.filter((a) => a.status === 'draft').length && <p className="muted">No drafts.</p>}
        {draftsAndScheduled.filter((a) => a.status === 'draft').map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div><strong style={{ fontSize: 13.5 }}>{a.title}</strong> <span className="muted" style={{ fontSize: 12 }}>· {a.type.replace('_', ' ')}</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusBadge status={a.status} />
              <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => startEdit(a)}>Edit</button>
              <button className="btn btn-teal" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => publish(a.id)}>Publish now</button>
              <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => remove(a.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Published</h3>
        {!published.length && <p className="muted">Nothing published yet.</p>}
        {published.map((a) => (
          <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 13.5 }}>{a.title}</strong>{a.version && <span className="badge badge-blue" style={{ marginLeft: 6 }}>v{a.version}</span>}
                <div className="muted" style={{ fontSize: 12 }}>Published {new Date(a.published_at).toLocaleString()} by {a.created_by}{a.force_cache_clear ? ' · forced reload' : ''}</div>
              </div>
              <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setPreviewId(previewId === a.id ? null : a.id)}>{previewId === a.id ? 'Hide' : 'View'}</button>
            </div>
            {previewId === a.id && <div style={{ marginTop: 10 }}><Markdown text={a.body} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
