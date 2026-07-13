import { useRef, useState } from 'react';
import { uploadImage } from '../lib/upload.js';

// Reusable photo picker: shows a thumbnail, uploads on select, calls
// onChange(url). Pass value (current url) and onChange.
export default function ImageInput({ value, onChange, label = 'photo' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      onChange(await uploadImage(file));
    } catch (ex) {
      setErr(ex.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, border: '1px solid var(--border)', background: 'var(--surface-2)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: value ? `url(${value})` : 'none' }} />
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: 'none' }} />
      <button type="button" className="btn" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : value ? 'Replace' : `Add ${label}`}
      </button>
      {value && <button type="button" className="btn btn-danger" onClick={() => onChange('')} disabled={busy}>Remove</button>}
      {err && <span className="badge badge-red">{err}</span>}
    </div>
  );
}
