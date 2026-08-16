import { useEffect, useRef, useState } from 'react';
import { uploadImage } from '../lib/upload.js';

// Full-screen finger-signature capture: a horizontal baseline with a
// left-aligned "x" (like a paper form), and an org-configurable prompt at
// the top. Draws at full canvas resolution (devicePixelRatio-scaled) so the
// signature stays crisp on high-DPI phones.
export default function SignaturePad({ promptText, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const drawBaseline = (ctx, w, h) => {
    ctx.save();
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = 1.5;
    const y = h - 32;
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(w - 16, y);
    ctx.stroke();
    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText('x', 6, y - 4);
    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    drawBaseline(ctx, rect.width, rect.height);
  }, []);

  const posFrom = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = posFrom(e); setEmpty(false); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = posFrom(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = (e) => { e.preventDefault(); drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, rect.width * dpr, rect.height * dpr);
    drawBaseline(ctx, rect.width, rect.height);
    setEmpty(true);
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'signature.png', { type: 'image/png' });
      const result = await uploadImage(file);
      onSave(result);
    } catch (ex) {
      setErr(ex.message || 'Could not save signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', textAlign: 'center', fontWeight: 600, fontSize: 15 }}>{promptText}</div>
      <canvas
        ref={canvasRef}
        style={{ flex: 1, width: '100%', touchAction: 'none', cursor: 'crosshair' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      {err && <p className="badge badge-red" style={{ margin: '0 20px 8px' }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 14, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn" onClick={clear} disabled={empty || saving}>Clear</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={empty || saving}>{saving ? 'Saving…' : 'Save signature'}</button>
        </div>
      </div>
    </div>
  );
}
