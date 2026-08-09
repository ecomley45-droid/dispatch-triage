import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHeader, Badge, useIsMobile, ListSkeleton } from '../components/ui.jsx';

const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const ACTION_TONE = { create: 'green', update: 'blue', delete: 'red', approve: 'green', invoice: 'blue', pay: 'green', member: 'amber', review: 'amber' };
const pretty = (t) => (t || '').replace(/_/g, ' ');

export default function AuditLog() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(null);
  const [action, setAction] = useState('all');

  useEffect(() => { api.list('/audit-log').then(setRows).catch(() => setRows([])); }, []);

  const actions = useMemo(() => ['all', ...Array.from(new Set((rows || []).map((r) => r.action)))], [rows]);
  const shown = (rows || []).filter((r) => action === 'all' || r.action === action);

  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change, who made it, and when" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {actions.map((a) => <button key={a} className={`btn ${action === a ? 'btn-teal' : ''}`} onClick={() => setAction(a)}>{a}</button>)}
      </div>

      {rows === null ? <ListSkeleton count={6} /> : isMobile ? (
        <div className="m-cards">
          {shown.map((r) => (
            <div key={r.id} className="m-card" style={{ cursor: 'default' }}>
              <div className="m-card-head"><div><div className="m-title">{r.summary || `${pretty(r.action)} ${pretty(r.entity_type)}`}</div><div className="m-meta">{r.actor_email || 'system'}</div></div><Badge value={r.action} /></div>
              <div className="m-facts"><span>{when(r.created_at)}</span></div>
            </div>
          ))}
          {!shown.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No activity yet.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.created_at)}</td>
                  <td>{r.actor_email || 'system'}</td>
                  <td><span className={`badge ${ACTION_TONE[r.action] ? 'badge-' + ACTION_TONE[r.action] : ''}`}>{pretty(r.action)}</span></td>
                  <td>{r.summary || `${pretty(r.action)} ${pretty(r.entity_type)}`}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 32 }}>No activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
