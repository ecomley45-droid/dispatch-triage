// Supabase-JS singleton (service_role key — server-only, bypasses RLS).
// Returns null when Supabase isn't configured, which flips the whole data
// layer over to the in-memory demo store (see lib/store.js).
import { createClient } from '@supabase/supabase-js';

let cached;

export function db() {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return cached;
}

export const isSupabaseConfigured = () => !!db();
