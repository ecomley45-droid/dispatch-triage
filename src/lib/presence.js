import { useEffect, useState } from 'react';
import { api } from './api.js';

// Polled "who's online" — replaces Supabase Realtime presence, which caps at
// 200 connections per channel (500 total on Pro) and can't hold 700-1,000
// simultaneous users on one presence:{orgId} channel. A heartbeat + windowed
// server lookup has no such ceiling and costs one small request per interval.
const HEARTBEAT_MS = 45_000;
const POLL_MS = 30_000;

export const presenceEnabled = () => true;

// Returns a map of online users: { [email]: { email, name, online_at } }.
// Polling also announces the current viewer as online (via the heartbeat).
export function usePresence(orgId, viewer) {
  const [online, setOnline] = useState({});
  useEffect(() => {
    if (!orgId || !viewer?.email) return;
    let stopped = false;

    const beat = () => api.post('/presence/heartbeat', {}).catch(() => {});
    const poll = async () => {
      try {
        const rows = await api.get('/presence');
        if (stopped) return;
        const map = {};
        for (const r of rows) map[String(r.email).toLowerCase()] = r;
        setOnline(map);
      } catch {
        // Network hiccup — keep the last known state rather than flashing empty.
      }
    };

    beat();
    poll();
    const beatId = setInterval(beat, HEARTBEAT_MS);
    const pollId = setInterval(poll, POLL_MS);
    return () => { stopped = true; clearInterval(beatId); clearInterval(pollId); };
  }, [orgId, viewer?.email]);
  return online;
}
