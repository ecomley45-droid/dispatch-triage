import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h}h ${String(m).padStart(2, '0')}m`; };

// Shift clock-in/out. Emits a 'shift-changed' event and listens for it so every
// instance (dashboard, schedule) stays in sync.
export default function ShiftClock() {
  const [shift, setShift] = useState(undefined); // undefined=loading | null=off | object=on
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = () => api.get('/shifts/current').then((r) => setShift(r.shift)).catch(() => setShift(null));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('shift-changed', h);
    return () => window.removeEventListener('shift-changed', h);
  }, []);
  useEffect(() => { if (!shift) return; const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, [shift]);

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api.post(shift ? '/shifts/clock-out' : '/shifts/clock-in', {});
      setShift(r.shift);
      window.dispatchEvent(new Event('shift-changed'));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  if (shift === undefined) return <div className="skeleton" style={{ width: 150, height: 36, borderRadius: 999 }} />;
  const on = !!shift;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button className={`btn ${on ? 'btn-danger' : 'btn-teal'}`} onClick={toggle} disabled={busy}>{busy ? '…' : on ? 'Clock out' : 'Clock in'}</button>
      <span className="muted" style={{ fontSize: 13 }}>{on ? `On shift · ${fmt(Date.now() - new Date(shift.clock_in).getTime())}` : 'Off the clock'}</span>
    </div>
  );
}
