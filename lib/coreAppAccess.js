// Cross-app access grants issued by Nexus Command, read directly from
// nexus-core's Supabase project — see
// nexus-core/packages/core/db/migrations/005_app_access.sql. Command's Users
// page lets an admin grant a Clerk user a role in this app (optionally
// scoped to one org; org_id null = app-wide), but until this file existed
// that grant was recorded and never consulted by Field.
//
// Mirrors @comley/nexus-core's listAppAccess (nexus-core/packages/core/src/
// index.js) inline rather than as a package dependency — same "deploys
// independently, can't depend on a sibling local repo" reasoning as
// lib/coreBilling.js (nexus-cms), which does the same for billing_accounts
// against the same Core project. Field doesn't have its own
// lib/coreFlags.js-equivalent yet; this is the first cross-project read of
// its kind in this app, so it follows the CMS sibling's shape exactly.
//
// Best-effort / non-fatal: callers only reach this after this app's own
// org_members lookup has already failed for the viewer, so a Core outage or
// missing env config here must never break this app's own login — it just
// means the extra grant isn't honored for that one request.
import { createClient } from '@supabase/supabase-js';

const APP_KEY = 'field';

const coreUrl = process.env.CORE_SUPABASE_URL;
const coreKey = process.env.CORE_SUPABASE_SERVICE_ROLE_KEY;
const core = coreUrl && coreKey ? createClient(coreUrl, coreKey) : null;
if (!core) console.warn('[coreAppAccess] CORE_SUPABASE_URL/CORE_SUPABASE_SERVICE_ROLE_KEY not set — app_access grants are disabled.');

// Looks up the Command-issued app_access grant for this Clerk user in this
// app, scoped to orgId. Pass the org's own id string for an org-scoped
// grant, or `null` for the app-wide (org_id IS NULL) grant. Returns
// { org_id, role } or null (not found, Core unreachable, or unconfigured).
export async function getAppAccess(clerkUserId, orgId) {
  if (!core || !clerkUserId) return null;
  try {
    let query = core.from('app_access').select('org_id, role')
      .eq('clerk_user_id', clerkUserId).eq('app_key', APP_KEY);
    query = orgId === null ? query.is('org_id', null) : query.eq('org_id', orgId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('[coreAppAccess] getAppAccess failed (non-fatal):', e.message);
    return null;
  }
}

// Claims a view-as handoff token's jti in Core's view_as_token_uses table
// (nexus-core/packages/core/db/migrations/011_view_as_token_uses.sql) —
// replaces lib/viewAsHandoff.js's old in-memory usedNonces Map, which only
// caught a replay within the same serverless instance and missed it across
// Vercel's multiple instances. Mirrors nexus-core's own
// claimViewAsTokenUse (apps/command/lib/core.js) inline, same
// repos-don't-share-code reasoning as getAppAccess above.
//
// Returns true on first use (claimed), false on replay (jti already
// exists) OR if Core is unreachable/unconfigured. Unlike getAppAccess, a
// Core outage here is NOT silently ignorable: the whole point of this
// check is to reject replays, so "couldn't verify" must mean "reject," not
// "let it through unenforced" — same fail-closed posture as Command's own
// verifyViewAsToken.
export async function claimViewAsTokenUse(jti) {
  if (!core || !jti) return false;
  try {
    const { error } = await core.from('view_as_token_uses').insert({ jti });
    if (error) {
      if (error.code === '23505') return false; // unique violation -- replay
      throw error;
    }
    return true;
  } catch (e) {
    console.error('[coreAppAccess] claimViewAsTokenUse failed, failing closed (rejecting):', e.message);
    return false;
  }
}
