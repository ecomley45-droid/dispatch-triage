import { useEffect, useState } from 'react';

// Per-browser UI preferences (navigation layout, accessibility). Kept in
// localStorage — no backend/schema — and broadcast so every component re-reads
// on change. Values are user-scoped to the device, which is the right model for
// personal layout/accessibility choices.
const KEY = 'dispatch-prefs';
const DEFAULTS = {
  mobilePins: [],       // nav paths pinned as icons on the mobile top bar
  desktopOrder: null,   // ordered nav paths for the desktop sidebar (null = default)
  bottomNav: null,      // ordered nav paths for the mobile bottom bar (null = default)
  logoRight: false,     // move the desktop brand/logo to the right
  contrast: false,      // high-contrast theme
  textSize: 'normal',   // 'normal' | 'large' | 'xlarge'
};

export function getPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('prefs-changed'));
  return next;
}

export function usePrefs() {
  const [p, setP] = useState(getPrefs);
  useEffect(() => {
    const h = () => setP(getPrefs());
    window.addEventListener('prefs-changed', h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener('prefs-changed', h); window.removeEventListener('storage', h); };
  }, []);
  return p;
}
