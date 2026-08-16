import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../lib/api.js';

// True on phone-width viewports (matches the CSS breakpoint). Re-renders on resize.
const mql = typeof window !== 'undefined' ? window.matchMedia('(max-width: 820px)') : null;
export function useIsMobile() {
  return useSyncExternalStore(
    (cb) => { mql?.addEventListener('change', cb); return () => mql?.removeEventListener('change', cb); },
    () => mql?.matches ?? false,
    () => false,
  );
}

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

// Shimmering placeholder block (YouTube-style). Compose these into page-shaped
// skeletons shown while data loads.
export function Skeleton({ w = '100%', h = 14, r = 8, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// A grid of card-shaped skeletons for list pages.
export function ListSkeleton({ count = 5 }) {
  return (
    <div className="m-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Skeleton w="55%" h={15} />
              <Skeleton w="75%" h={11} style={{ marginTop: 8 }} />
            </div>
            <Skeleton w={64} h={22} r={999} />
          </div>
          <Skeleton w="40%" h={11} style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

// Animated indeterminate loading bar — use instead of static "Loading…" text.
export function Loading({ label, style }) {
  return (
    <div style={{ padding: 28, display: 'grid', placeItems: 'center', gap: 10, ...style }}>
      <div className="loadingbar"><span /></div>
      {label && <div className="muted" style={{ fontSize: 13 }}>{label}</div>}
    </div>
  );
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
    <div onClick={onClose} className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card modal-card" style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 22 }}>
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
    <div style={{ marginBottom: 14, minWidth: 0 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

const STATUS_TONE = {
  active: 'green', in_progress: 'blue', scheduled: 'blue', en_route: 'amber', on_site: 'amber',
  completed: 'green', done: 'green', open: 'amber', blocked: 'red', requested: 'amber',
  on_hold: 'amber', planning: 'blue', unscheduled: '', cancelled: 'red', archived: '',
  urgent: 'red', high: 'red', medium: 'amber', low: '',
  // invoices
  draft: '', sent: 'blue', paid: 'green', void: 'red', invoiced: 'green',
};
export function Badge({ value }) {
  const tone = STATUS_TONE[value] ?? '';
  const cls = tone ? `badge badge-${tone}` : 'badge';
  return <span className={cls}>{String(value || '').replace(/_/g, ' ')}</span>;
}

export const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');

// Searchable name dropdown: type to filter, names sorted alphabetically.
// Drop-in replacement for `<select>{members.map(m => <option .../>)}</select>`.
// `placeholder` renders as a selectable "— unassigned —"-style empty option
// (value ''); `extraOptions` are fixed non-name choices (e.g. "All techs")
// that stay in the given order, listed above the alphabetized names.
export function NameSelect({ members = [], value, onChange, placeholder, extraOptions = [], disabled, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const named = members
      .map((m) => ({ value: m.user_email, label: m.name || m.user_email }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    const placeholderOpt = placeholder ? [{ value: '', label: placeholder }] : [];
    return [...placeholderOpt, ...extraOptions, ...named];
  }, [members, placeholder, extraOptions]);

  const selected = options.find((o) => o.value === value) || null;
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (opt) => { onChange(opt.value); close(); inputRef.current?.blur(); };
  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) pick(filtered[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        className="input"
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected?.label ?? placeholder ?? 'Select…'}
        onFocus={() => { setOpen(true); setQuery(''); setHi(0); }}
        onChange={(e) => { setQuery(e.target.value); setHi(0); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <div role="listbox" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', maxHeight: 240, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.22)', zIndex: 80 }}>
          {filtered.length ? filtered.map((o, i) => (
            <div key={o.value} role="option" aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHi(i)}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, background: i === hi ? 'var(--surface-2)' : 'transparent', fontWeight: o.value === value ? 700 : 500 }}>
              {o.label}
            </div>
          )) : <div className="muted" style={{ padding: '10px 10px', fontSize: 13 }}>No match</div>}
        </div>
      )}
    </div>
  );
}
