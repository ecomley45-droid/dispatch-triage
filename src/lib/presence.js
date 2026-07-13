import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

// Client-side Supabase used ONLY for Realtime presence (who's online) with the
// public publishable key. No table, no polling — presence state is held by the
// Realtime channel while tabs are open.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
let client;
function sb() {
  if (client !== undefined) return client; // resolved once (a client or null)
  client = (url && key) ? createClient(url, key, { realtime: { params: { eventsPerSecond: 1 } } }) : null;
  return client;
}

export const presenceEnabled = () => !!(url && key);

// Returns a map of online users: { [email]: { email, name, online_at } }.
// Joining the channel also announces the current viewer as online.
export function usePresence(orgId, viewer) {
  const [online, setOnline] = useState({});
  useEffect(() => {
    const c = sb();
    if (!c || !orgId || !viewer?.email) return;
    const email = viewer.email.toLowerCase();
    const channel = c.channel(`presence:${orgId}`, { config: { presence: { key: email } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const map = {};
      for (const [k, metas] of Object.entries(state)) map[k] = metas[metas.length - 1];
      setOnline(map);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track({ email, name: viewer.name, online_at: new Date().toISOString() });
    });
    return () => { c.removeChannel(channel); };
  }, [orgId, viewer?.email, viewer?.name]);
  return online;
}
