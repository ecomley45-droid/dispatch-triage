// Platform-wide release notes / announcements. Supabase-only (like
// lib/imports.js) — these tables have no org_id, so they sit outside
// store.js's generic org-scoped CRUD; the shared cache-version counter is
// the one piece that already works in demo mode too, via store.js's
// existing platform_settings get/set (both backends implement it).
import { createHash } from 'node:crypto';
import { db, isSupabaseConfigured } from './db.js';
import { store } from './store.js';
import { PRESET_ROLES } from './permissions.js';

const CACHE_VERSION_KEY = 'announcements_cache_version';

// Staged rollout: a real-time push to every client the instant something
// publishes would spike the DB with every user's browser hitting the unread
// check (and then read/dismiss) at once. Instead, each viewer becomes
// eligible to see a given announcement at publish time + a role-tier base
// delay + a small random-but-stable jitter within that tier, so the load
// (and the "everyone pings support at once" effect of a announcement) spreads
// out over tens of minutes instead of landing in one instant. Org admins /
// managers see it first (they're also who support escalates to), field roles
// last. Jitter is a deterministic hash of (announcement, viewer) — not
// Math.random() — so the same user always gets the same offset for a given
// announcement instead of the banner flickering in and out across polls.
const ROLE_TIER_DELAY_MS = {
  org_admin: 0,
  manager_admin: 0,
  accountant_admin: 15 * 60_000,
  dispatcher: 30 * 60_000,
  technician: 45 * 60_000,
};
const DEFAULT_TIER_DELAY_MS = 45 * 60_000; // unknown/custom roles: safest = last, same as technician
const JITTER_WINDOW_MS = 10 * 60_000; // extra spread within a tier so it isn't ALL of e.g. "every technician" at once either

function jitterMs(seed) {
  const hash = createHash('sha256').update(seed).digest();
  return hash.readUInt32BE(0) % JITTER_WINDOW_MS;
}

function eligibleAt(publishedAt, role, seed) {
  const base = new Date(publishedAt).getTime();
  const delay = (ROLE_TIER_DELAY_MS[role] ?? DEFAULT_TIER_DELAY_MS) + jitterMs(seed);
  return base + delay;
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    throw Object.assign(new Error('Announcements require a connected Supabase database — not available in local demo mode.'), { status: 400 });
  }
}

const TYPES = ['release_note', 'announcement', 'maintenance'];
const STATUSES = ['draft', 'scheduled', 'published'];

function validateDraft({ title, body, type, scheduled_at }) {
  if (!title?.trim()) throw Object.assign(new Error('Title is required'), { status: 400 });
  if (!body?.trim()) throw Object.assign(new Error('Body is required'), { status: 400 });
  if (type && !TYPES.includes(type)) throw Object.assign(new Error(`type must be one of: ${TYPES.join(', ')}`), { status: 400 });
  if (scheduled_at && Number.isNaN(new Date(scheduled_at).getTime())) throw Object.assign(new Error('scheduled_at is not a valid date'), { status: 400 });
}

export async function bumpCacheVersion() {
  const current = Number((await store.getPlatformSetting(CACHE_VERSION_KEY)) || 0);
  const next = current + 1;
  await store.setPlatformSetting(CACHE_VERSION_KEY, next);
  return next;
}

export async function getCacheVersion() {
  return Number((await store.getPlatformSetting(CACHE_VERSION_KEY)) || 0);
}

// ---------------------------------------------------------------------------
// Super admin console
// ---------------------------------------------------------------------------

export async function listAnnouncements({ status, type } = {}) {
  requireSupabase();
  let q = db().from('announcements').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getAnnouncement(id) {
  requireSupabase();
  const { data, error } = await db().from('announcements').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Announcement not found'), { status: 404 });
  return data;
}

export async function createAnnouncement(fields, actorEmail) {
  requireSupabase();
  validateDraft(fields);
  const status = fields.scheduled_at ? 'scheduled' : 'draft';
  const { data, error } = await db().from('announcements').insert({
    title: fields.title.trim(), body: fields.body, type: fields.type || 'announcement',
    version: fields.version || null, force_cache_clear: !!fields.force_cache_clear,
    scheduled_at: fields.scheduled_at || null, status, created_by: actorEmail, updated_by: actorEmail,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateAnnouncement(id, fields, actorEmail) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (existing.status === 'published') {
    throw Object.assign(new Error('A published announcement can\'t be edited — unpublish isn\'t supported (it may already be cached/seen); create a new entry instead.'), { status: 400 });
  }
  validateDraft({ ...existing, ...fields });
  const patch = { updated_by: actorEmail, updated_at: new Date().toISOString() };
  for (const k of ['title', 'body', 'type', 'version', 'force_cache_clear', 'scheduled_at']) if (fields[k] !== undefined) patch[k] = fields[k];
  patch.status = patch.scheduled_at !== undefined ? (patch.scheduled_at ? 'scheduled' : 'draft') : existing.status;
  const { data, error } = await db().from('announcements').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteAnnouncement(id) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (existing.status === 'published') throw Object.assign(new Error('A published announcement can\'t be deleted (it may already be cached/seen) — this would break the Help page changelog history.'), { status: 400 });
  const { error } = await db().from('announcements').delete().eq('id', id);
  if (error) throw error;
}

export async function publishNow(id, actorEmail) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (existing.status === 'published') return existing;
  const { data, error } = await db().from('announcements').update({
    status: 'published', published_at: new Date().toISOString(), updated_by: actorEmail,
  }).eq('id', id).select().single();
  if (error) throw error;
  await bumpCacheVersion();
  return data;
}

// ---------------------------------------------------------------------------
// Scheduling — the cron entrypoint (Vercel Cron, matching /api/cron/backup
// etc. rather than a Supabase Edge Function + pg_cron, since that's the
// scheduling mechanism this app already runs everywhere else) AND an
// opportunistic self-heal: listUnreadForViewer() below calls this too, so a
// due announcement goes live the moment any user's client polls, without
// waiting on the cron tick — a coarse daily/hourly cron on a Hobby Vercel
// plan is still fine because live traffic covers the gap.
export async function publishDueAnnouncements() {
  requireSupabase();
  const nowIso = new Date().toISOString();
  const { data: due, error } = await db().from('announcements').select('id')
    .eq('status', 'scheduled').lte('scheduled_at', nowIso);
  if (error) throw error;
  if (!due?.length) return { published: 0 };
  const { error: updErr } = await db().from('announcements')
    .update({ status: 'published', published_at: nowIso })
    .in('id', due.map((r) => r.id));
  if (updErr) throw updErr;
  await bumpCacheVersion();
  return { published: due.length };
}

// ---------------------------------------------------------------------------
// Delivery — every authenticated user, any org
// ---------------------------------------------------------------------------

export async function listPublished({ type, limit = 50 } = {}) {
  requireSupabase();
  let q = db().from('announcements').select('id, title, body, type, version, published_at')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(limit);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Polled by every logged-in client (src/lib/announcements.js). Opportunistically
// publishes anything due first, so this single cheap call both self-heals
// scheduling AND tells the caller what's new for them. `role` drives the
// staged-rollout eligibility window (see eligibleAt above) — a viewer never
// sees a published announcement before their role tier's turn, even though
// it's already `status = 'published'` for everyone else.
export async function getUnreadForViewer(email, role) {
  requireSupabase();
  await publishDueAnnouncements().catch(() => {}); // best-effort; a cron miss shouldn't break the poll
  const [{ data: published, error: pubErr }, { data: reads, error: readErr }, cacheVersion] = await Promise.all([
    db().from('announcements').select('id, title, body, type, version, published_at, force_cache_clear')
      .eq('status', 'published').order('published_at', { ascending: false }).limit(20),
    db().from('user_announcement_reads').select('announcement_id').eq('user_email', email.toLowerCase()),
    getCacheVersion(),
  ]);
  if (pubErr) throw pubErr;
  if (readErr) throw readErr;
  const readIds = new Set((reads || []).map((r) => r.announcement_id));
  const now = Date.now();
  const unread = (published || [])
    .filter((a) => !readIds.has(a.id))
    .filter((a) => now >= eligibleAt(a.published_at, role, `${a.id}:${email.toLowerCase()}`));
  return { unread, cacheVersion };
}

export async function markRead(email, announcementId) {
  requireSupabase();
  const { error } = await db().from('user_announcement_reads')
    .upsert({ user_email: email.toLowerCase(), announcement_id: announcementId, read_at: new Date().toISOString() }, { onConflict: 'user_email,announcement_id' });
  if (error) throw error;
}

export { TYPES as ANNOUNCEMENT_TYPES, STATUSES as ANNOUNCEMENT_STATUSES };
