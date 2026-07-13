import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Data hook: loads a resource list and exposes create/update/remove that keep
// local state in sync. `path` is the API path (e.g. '/projects').
export function useResource(path) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    api.get(path)
      .then((data) => { setRows(data); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);

  const create = async (body) => { const row = await api.post(path, body); setRows((r) => [row, ...r]); return row; };
  const update = async (id, body) => { const row = await api.patch(`${path}/${id}`, body); setRows((r) => r.map((x) => (x.id === id ? row : x))); return row; };
  const remove = async (id) => { await api.del(`${path}/${id}`); setRows((r) => r.filter((x) => x.id !== id)); };

  return { rows, loading, error, reload, create, update, remove };
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

const STATUS_TONE = {
  active: 'green', in_progress: 'blue', scheduled: 'blue', en_route: 'amber',
  completed: 'green', done: 'green', open: 'amber', blocked: 'red',
  on_hold: 'amber', planning: 'blue', unscheduled: '', cancelled: 'red', archived: '',
  urgent: 'red', high: 'red', medium: 'amber', low: '',
};
export function Badge({ value }) {
  const tone = STATUS_TONE[value] ?? '';
  const cls = tone ? `badge badge-${tone}` : 'badge';
  return <span className={cls}>{String(value || '').replace(/_/g, ' ')}</span>;
}

export const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');
