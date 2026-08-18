// Client side of the announcements system: polls for unread items (staged by
// role tier server-side, see lib/announcements.js), and reacts to the global
// cache-version counter changing by clearing the local response cache — and,
// only when the triggering announcement has force_cache_clear set, doing a
// full reload. Polling, not a Realtime subscription — same rationale as
// src/lib/presence.js (Supabase Realtime's per-channel connection cap doesn't
// scale to every logged-in user across every workspace).
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { cacheClearAll } from './cache.js';

const POLL_MS = 3 * 60_000;
const VERSION_KEY = 'nf_announcements_cache_version';

export function useAnnouncements(viewerEmail) {
  const [unread, setUnread] = useState([]);
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(VERSION_KEY) : null;
  const lastVersion = useRef(stored === null ? null : Number(stored));

  useEffect(() => {
    if (!viewerEmail) return;
    let alive = true;
    const poll = async () => {
      let result;
      try { result = await api.get('/announcements/unread'); } catch { return; } // offline / not yet authenticated — retry next tick
      if (!alive) return;
      const { unread: items, cacheVersion } = result;
      setUnread(items);
      // Only react to a version CHANGE, never to establishing the baseline —
      // otherwise a brand-new browser with no stored version would treat
      // "first ever read" as a change and reload itself pointlessly.
      if (lastVersion.current !== null && cacheVersion !== lastVersion.current) {
        await cacheClearAll();
        if (items.some((a) => a.force_cache_clear)) window.location.reload();
      }
      lastVersion.current = cacheVersion;
      try { localStorage.setItem(VERSION_KEY, String(cacheVersion)); } catch { /* private browsing, etc. */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [viewerEmail]);

  const markRead = (id) => {
    setUnread((list) => list.filter((a) => a.id !== id));
    api.post(`/announcements/${id}/read`, {}).catch(() => {});
  };

  return { unread, markRead };
}
