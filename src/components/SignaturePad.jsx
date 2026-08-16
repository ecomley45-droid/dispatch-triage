import { useEffect, useRef, useState } from 'react';
import { uploadImage } from '../lib/upload.js';

// Full-screen finger-signature capture: a horizontal baseline with a
// left-aligned "x" (like a paper form), and an org-configurable prompt at
// the top. Always a white paper-like surface — regardless of app theme, a
// signature is meant to look the same as ink on paper, and dark-mode text/
// line colors would go invisible against it.
const BG = '#ffffff';
const INK = '#1a1a2e';
const LINE = '#9aa0a6';
const TEXT = '#1a1a2e';

// Draws at full canvas resolution (devicePixelRatio-scaled) so the signature
// stays crisp on high-DPI phones.
function drawBaseline(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  const y = h - 32;
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(w - 16, y);
  ctx.stroke();
  ctx.font = '22px sans-serif';
  ctx.fillStyle = LINE;
  ctx.fillText('x', 6, y - 4);
  ctx.restore();
}

// A plain, theme-independent button (not the app's .btn class, whose colors
// are theme CSS vars — in dark mode that text/border renders in light colors
// meant for a dark page, which disappear against this pad's forced-white
// background).
function PadButton({ primary, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        background: primary ? INK : '#fff', color: primary ? '#fff' : INK,
        border: `1px solid ${primary ? INK : '#c7c9d1'}`,
        opacity: props.disabled ? 0.5 : 1,
      }}
    />
  );
}

export default function SignaturePad({ promptText, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Landscape-only signing surface: a signature line should always be wide,
  // never cramped into a tall strip. On a portrait phone the whole pad is
  // pre-rotated 90° via CSS, so turning the phone sideways (the natural
  // motion for signing) presents it upright and full-width; on a device
  // already in landscape it renders unrotated. orientationchange/resize keep
  // this in sync as the phone is turned either way.
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const onOrient = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', onOrient);
    window.addEventListener('orientationchange', onOrient);
    return () => { window.removeEventListener('resize', onOrient); window.removeEventListener('orientationchange', onOrient); };
  }, []);

  // The pad's own (pre-rotation) box size. In portrait we swap the viewport
  // dimensions so the rotated box exactly fills the screen; in landscape it
  // already matches the viewport.
  const padW = portrait ? window.innerHeight : window.innerWidth;
  const padH = portrait ? window.innerWidth : window.innerHeight;

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = padW * dpr;
    canvas.height = padH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    drawBaseline(ctx, padW, padH);
  };
  // Re-init (and clear) whenever the pad's own box size changes — a mid-sign
  // orientation flip would otherwise leave the drawing scaled/misaligned.
  useEffect(() => { setupCanvas(); setEmpty(true); }, [padW, padH]);

  // Touches always arrive in real, unrotated viewport coordinates (clientX/Y
  // are never affected by CSS transforms on ancestors). getBoundingClientRect()
  // on the CANVAS itself, though, always reports its true on-screen box, fully
  // accounting for any ancestor rotation — for a 90°-rotated element that box
  // has width/height swapped from its real (local, pre-rotation) size. Using
  // the canvas's own rect center as the pivot (rather than the viewport's, or
  // the outer pad's) keeps this correct regardless of where the canvas sits
  // inside the pad — e.g. offset down by the header, short of the full pad
  // height because of the footer — with no layout offsets to hand-derive.
  const posFrom = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!portrait) return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    const localW = rect.height, localH = rect.width; // swapped: rect is post-rotation
    const ccx = rect.left + rect.width / 2, ccy = rect.top + rect.height / 2;
    const dxp = t.clientX - ccx, dyp = t.clientY - ccy;
    // Inverse of CSS rotate(90deg) (clockwise) about the canvas's own center.
    return { x: localW / 2 + dyp, y: localH / 2 - dxp };
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

  const clear = () => { setupCanvas(); setEmpty(true); };

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
    <div style={{ position: 'fixed', inset: 0, background: BG, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Rotation toggles a CSS property on a wrapper that's ALWAYS present
          (never conditionally rendered) — swapping the wrapper in and out of
          the tree would change the canvas's structural position and cause
          React to unmount/remount it, silently dropping the drawing setup
          that runs in the effect below. */}
      <div style={{ width: padW, height: padH, transform: portrait ? 'rotate(90deg)' : 'none' }}>
        <div style={{ width: '100%', height: '100%', background: BG, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid #e2e3e8`, textAlign: 'center', fontWeight: 600, fontSize: 15, color: TEXT, flexShrink: 0 }}>{promptText}</div>
          <canvas
            ref={canvasRef}
            style={{ flex: 1, width: '100%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          {err && <p style={{ margin: '0 20px 8px', color: '#c23028', fontSize: 13, flexShrink: 0 }}>{err}</p>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 14, borderTop: `1px solid #e2e3e8`, flexShrink: 0 }}>
            <PadButton onClick={clear} disabled={empty || saving}>Clear</PadButton>
            <div style={{ display: 'flex', gap: 8 }}>
              <PadButton onClick={onCancel} disabled={saving}>Cancel</PadButton>
              <PadButton primary onClick={save} disabled={empty || saving}>{saving ? 'Saving…' : 'Save signature'}</PadButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
