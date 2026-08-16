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

// Real viewport size, read fresh every time (never cached in state). Mobile
// Safari's address bar show/hide can leave window.innerWidth/Height briefly
// stale right at an orientation change; documentElement's client box tracks
// the actual current layout viewport more reliably.
const viewportSize = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });

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
  const [portrait, setPortrait] = useState(() => { const { w, h } = viewportSize(); return h > w; });
  useEffect(() => {
    const onOrient = () => { const { w, h } = viewportSize(); setPortrait(h > w); };
    window.addEventListener('resize', onOrient);
    window.addEventListener('orientationchange', onOrient);
    return () => { window.removeEventListener('resize', onOrient); window.removeEventListener('orientationchange', onOrient); };
  }, []);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // offsetWidth/Height are the element's own layout box size — unaffected
    // by any CSS transform on it or its ancestors — so these stay accurate
    // even while (or right after) the pad is rotated.
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (!w || !h) return; // not laid out yet — a pending rAF/timeout retry below will catch it
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    drawBaseline(ctx, w, h);
  };
  // Re-init (and clear) on every orientation flip. A device can report a
  // stale layout for one frame right as the rotation/viewport settles, so
  // retry shortly after too rather than trusting only the first read.
  useEffect(() => {
    setupCanvas();
    const raf = requestAnimationFrame(setupCanvas);
    const t = setTimeout(setupCanvas, 150);
    setEmpty(true);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [portrait]);

  // Map a raw touch point (real, untransformed screen coordinates — touch
  // clientX/Y are never affected by CSS transforms on ancestors) into the
  // canvas's own local drawing space.
  //
  // Deliberately avoids getBoundingClientRect() on the rotated element:
  // some mobile browsers are unreliable computing it under a live CSS
  // transform, especially combined with an in-flight viewport/orientation
  // change — which is exactly the class of bug this pad hit. Instead the
  // rotated wrapper is anchored with `transform-origin: top left; transform:
  // rotate(90deg) translateY(-100%)`, a closed-form recipe that places its
  // rotated box exactly at screen (0,0) with visual size (viewport width) ×
  // (viewport height) — provable from the CSS alone, so the inverse mapping
  // below needs only the current viewport WIDTH (read fresh, not the
  // rotated box's rendered geometry) — no DOM measurement of the transformed
  // element at all. canvas.offsetLeft/Top (also transform-independent by
  // spec) then place the touch within the canvas itself.
  const posFrom = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const canvas = canvasRef.current;
    let lx, ly;
    if (!portrait) {
      lx = t.clientX; ly = t.clientY;
    } else {
      const { w: vw } = viewportSize();
      lx = t.clientY;
      ly = vw - t.clientX;
    }
    return { x: lx - canvas.offsetLeft, y: ly - canvas.offsetTop };
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
    <div style={{ position: 'fixed', inset: 0, background: BG, zIndex: 200, overflow: 'hidden' }}>
      {/* Local box: in portrait, its width/height are the SWAPPED viewport
          dims (100dvh × 100dvw) so that once rotated 90°, its visual
          footprint exactly matches the real (100dvw × 100dvh) viewport.
          dvh/dvw (dynamic viewport units) track the actually-visible area
          through mobile Safari's address-bar animations — plain vh/vw can
          under- or over-shoot mid-transition, which is what produced the
          mostly-blank pad. Anchored top-left, never centered, so there's no
          separate flex/margin computation to go stale either. */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: portrait ? '100dvh' : '100dvw',
        height: portrait ? '100dvw' : '100dvh',
        transformOrigin: 'top left',
        transform: portrait ? 'rotate(90deg) translateY(-100%)' : 'none',
        background: BG, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid #e2e3e8`, textAlign: 'center', fontWeight: 600, fontSize: 15, color: TEXT, flexShrink: 0 }}>{promptText}</div>
        <canvas
          ref={canvasRef}
          // minHeight/minWidth: 0 override the flex item default of
          // min-height:auto — without it a <canvas> (a replaced element with
          // its own intrinsic size, which grows every time setupCanvas() sets
          // canvas.height to a new pixel value) refuses to shrink to its
          // flex:1 share and overflows the pad instead, which is what broke
          // both the landscape layout and the touch math (computed against
          // the intended size, not the actually-overflowing one).
          style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
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
  );
}
