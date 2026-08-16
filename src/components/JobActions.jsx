import { useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';

// The field-tech action row for a work order. Only "Job complete" marks the job
// done (status=completed); a manager must still Approve for it to be truly over.
// Start/Take break/Stop/Complete also drive the per-job time clock.
const ACTIONS = ['On the way', 'Start job', 'Take break', 'Stop Job', 'Job complete'];

export default function JobActions({ wo, onChange, size = 'sm' }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const email = me.viewer?.email;
  const canApprove = me.can('work_orders:approve');

  const openEntry = async () => {
    const rows = await api.list(`/time-entries?work_order_id=${wo.id}`);
    return rows.find((t) => !t.clock_out && t.user_email === email) || null;
  };
  const clockIn = async () => { if (!(await openEntry())) await api.post('/time-entries', { work_order_id: wo.id, clock_in: new Date().toISOString() }); };
  const clockOut = async () => { const e = await openEntry(); if (e) await api.patch(`/time-entries/${e.id}`, { clock_out: new Date().toISOString() }); };

  // tech-update is the narrow status/resolution/signature endpoint a plain
  // technician can call (the full PATCH below needs work_orders:write, which
  // technicians don't have — using it here would 403 for them).
  const setStatus = (body) => api.patch(`/work-orders/${wo.id}/tech-update`, body);

  const act = async (label) => {
    setBusy(true);
    try {
      if (label === 'On the way') onChange(await setStatus({ status: 'en_route' }));
      else if (label === 'Start job') { await clockIn(); onChange(await setStatus({ status: 'on_site' })); }
      else if (label === 'Take break') { await clockOut(); }
      else if (label === 'Stop Job') { await clockOut(); onChange(await setStatus({ status: 'scheduled' })); }
      else if (label === 'Job complete') { await clockOut(); onChange(await setStatus({ status: 'completed', completed_at: wo.completed_at || new Date().toISOString() })); }
      else if (label === 'Approve') onChange(await api.post(`/work-orders/${wo.id}/approve`, {}));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const done = wo.status === 'completed' || wo.status === 'invoiced';
  const btn = size === 'lg' ? 'btn' : 'btn';
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {ACTIONS.map((b) => (
        <button key={b} className={`${btn} ${b === 'Job complete' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act(b)}>{b}</button>
      ))}
      {canApprove && done && !wo.approved_at && <button className="btn btn-teal" disabled={busy} onClick={() => act('Approve')}>Approve (manager)</button>}
      {wo.approved_at && <span className="badge badge-green" style={{ alignSelf: 'center' }}>Approved</span>}
    </div>
  );
}
