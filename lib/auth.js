// Auth + authorization, ported/trimmed from the comley-nexus pattern.
//
//   resolveViewer(req): attaches req.viewer { email, name, role } and req.org
//   { id, slug, name, role } from Clerk + the org_members table.
//
//   requireAuth / requireCapability(cap): gate routes. Instead of a single
//   role rank, this app uses a capability map because the three roles aren't a
//   clean hierarchy — a dispatcher can touch jobs an accountant can't, and vice
//   versa for item costs.
//
// Dev bypass: when Clerk isn't configured and NODE_ENV !== 'production', every
// request is a synthetic manager_admin ('dev@localhost'). Production refuses to
// start without CLERK_SECRET_KEY.
import { clerkMiddleware, clerkClient } from '@clerk/express';
import { loadSharedViewer } from './dualAuth.js';
import { verifySharedSessionCookie } from './viewAsToken.js';
import { SHARED_SESSION_COOKIE } from './sessionHandoff.js';
import { getAppAccess } from './coreAppAccess.js';
import { store } from './store.js';
import { CAPABILITIES, PRESET_ROLES, PAGE_KEYS, presetPerms, sanitizePerms, isRestrictedRole, disabledFeaturePages, disabledFeatureCaps, featureActive, enterpriseCaps } from './permissions.js';

// The permission catalog is the single source of truth; re-export the pieces the
// rest of the server imports from here for back-compat.
export { CAPABILITIES } from './permissions.js';
export const ROLES = PRESET_ROLES;

// Preset-only capability check (used by tests + the static presets). Custom-role
// capability checks go through the resolved req.viewer.capabilities set instead.
export const can = (role, cap) => (CAPABILITIES[cap] || []).includes(role);

// Resolve a role key (preset OR custom) to { pages, caps, readPages }.
//   pages     — nav visibility + route guard (what the role sees)
//   caps      — write/action capabilities
//   readPages — pages whose data the role may READ (server read-gate)
// Presets read everything (matching the pre-Role-Editor behavior where reads
// were open to any member); their `pages` stays nav-restrictive so the menu is
// unchanged. Custom roles unify the two: you can only read what you can see.
// Cached per (org, role) with the same short TTL as the org/user caches.
const roleCache = new Map(); // `${org}:${role}` -> { data, exp }
// Clear the resolved-perms cache. With no args, clears everything (used when a
// platform-wide default changes, which affects every workspace).
export function invalidateRoleCache(orgId, roleKey) {
  if (orgId && roleKey) roleCache.delete(`${orgId}:${roleKey}`);
  else roleCache.clear();
}
export async function resolveRolePerms(orgId, roleKey) {
  const key = `${orgId}:${roleKey}`;
  const hit = roleCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const preset = presetPerms(roleKey);
  let data;
  if (preset) {
    // Layer overrides over the code default: platform default (Super Admin) can
    // change pages AND caps; a per-workspace override can change PAGES only, or
    // hide the role. See lib/permissions.js FEATURE/role notes.
    let pages = preset.pages;
    let caps = preset.caps;
    const platform = await store.getRoleDefault(roleKey).catch(() => null);
    if (Array.isArray(platform?.pages)) pages = platform.pages;
    if (Array.isArray(platform?.caps)) caps = platform.caps;
    const wsRow = await store.getRole(orgId, roleKey).catch(() => null);
    if (Array.isArray(wsRow?.permissions?.pages)) pages = wsRow.permissions.pages;
    // Reads follow the effective page set once a page override exists (so hiding
    // a page actually blocks its data); otherwise legacy presets read everything.
    const hasPageOverride = Array.isArray(platform?.pages) || Array.isArray(wsRow?.permissions?.pages);
    const readPages = isRestrictedRole(roleKey) ? pages : (hasPageOverride ? pages : PAGE_KEYS);
    data = { pages: new Set(pages), caps: new Set(caps), readPages: new Set(readPages) };
  } else {
    const row = await store.getRole(orgId, roleKey);
    const perms = sanitizePerms(row?.permissions || {});
    data = { pages: new Set(perms.pages), caps: new Set(perms.caps), readPages: new Set(perms.pages) };
  }
  roleCache.set(key, { data, exp: Date.now() + CACHE_MS });
  return data;
}

const isProd = () => process.env.NODE_ENV === 'production';
const clerkConfigured = () => !!process.env.CLERK_SECRET_KEY;

export function assertProductionAuth() {
  if (isProd() && !clerkConfigured()) {
    throw new Error('CLERK_SECRET_KEY is required in production. Refusing to start.');
  }
}

export function attachClerk(app) {
  if (!clerkConfigured()) return;
  // @clerk/express needs BOTH keys. The Clerk CLI writes the publishable key
  // under the Vite-prefixed name (.env.local), so accept that as a fallback
  // rather than duplicating it as CLERK_PUBLISHABLE_KEY.
  app.use(clerkMiddleware({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY,
  }));
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Platform (super-admin) operators — the people who run Nexus Field itself, as
// opposed to a client workspace's own Manager Admin. Gated by a dedicated
// allowlist so the two tiers never conflate. Falls back to ADMIN_EMAILS when
// unset so an existing single-operator deploy keeps working.
const platformAdminEmails = () => {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
};

// Per-instance caches so we don't hit Clerk (network) and the org lookup on
// every single API request. Serverless instances stay warm across a burst of
// requests (e.g. the dashboard's parallel fetches), so this cuts latency a lot.
const CACHE_MS = 60_000;
const userCache = new Map(); // userId -> { data, exp }
const orgCache = new Map();  // email  -> { data, exp }

async function loadClerkUser(userId) {
  const hit = userCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = await loadClerkUserUncached(userId);
  userCache.set(userId, { data, exp: Date.now() + CACHE_MS });
  return data;
}

async function cachedOrgForUser(email, slug = null) {
  const key = slug ? `${email}::${slug}` : email;
  const hit = orgCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = await store.orgForUser(email, slug);
  orgCache.set(key, { data, exp: Date.now() + CACHE_MS });
  return data;
}

// The active workspace slug the client requests, from the X-Workspace header.
// It only SELECTS among the caller's memberships — store.orgForUser(email, slug)
// still verifies membership, so a forged slug can't reach another org's data.
const workspaceSlug = (req) => {
  const raw = req.get?.('X-Workspace') || req.headers?.['x-workspace'] || '';
  const slug = String(raw).trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(slug) ? slug : null;
};

async function loadClerkUserUncached(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = (user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || '').toLowerCase();
    const metaRole = user?.publicMetadata?.role;
    const role = adminEmails().includes(email)
      ? 'org_admin'
      : (ROLES.includes(metaRole) ? metaRole : 'dispatcher');
    return {
      userId,
      email,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email,
      image: user?.imageUrl || null,
      role,
    };
  } catch {
    return null;
  }
}

// A super-admin can "view as" any workspace via an httpOnly `view_as` cookie
// (set by the super-admin-only view-as endpoint). When present, it overrides
// real membership and impersonates that org AS AN ADMIN — no membership row,
// no audit trail. Only honored for super-admins.
async function viewAsOrg(req, viewer) {
  const raw = req.cookies?.view_as;
  if (!raw || !isPlatformAdmin(viewer)) return null;
  // The cookie is JSON ({org, role}) so a demo can impersonate any role, not
  // just the top admin preset — older cookies pre-dating that are a bare org
  // id string, so fall back to treating the whole value as the org id.
  let target, role;
  try { ({ org: target, role } = JSON.parse(raw)); } catch { target = raw; }
  if (!target) return null;
  const org = await store.getOrg(target);
  if (!org) return null;
  return { id: org.id, slug: org.id, name: org.name, role: role || 'org_admin', feature_flags: org.feature_flags || {}, branding: org.branding || {}, plan: org.plan || 'starter', viewingAs: true };
}

// Additional grant source for a viewer authenticated via the shared-Clerk
// fallback (lib/dualAuth.js) who has no membership row of their own in this
// app's org_members — consults Nexus Command's app_access grants
// (nexus-core/packages/core/db/migrations/005_app_access.sql,
// lib/coreAppAccess.js) instead of leaving them with no workspace.
//
// Only reachable via a shared-Clerk session (see resolveViewer below) — this
// app's own primary-Clerk-instance login path never calls this.
//
//   - Org-scoped grant (org_id set to a specific org): that org is this
//     viewer's de-facto workspace here, usable with or without an explicit
//     X-Workspace slug (as long as a given slug matches).
//   - App-wide grant (org_id null): grants the role for ANY org, but Field
//     has no "browse all orgs" UI for a non-member to discover which org to
//     open — same limitation the super-admin view-as flow had before its
//     cookie-driven org picker existed. An explicit X-Workspace slug is
//     required to select one; with no slug this resolves to nothing
//     (documented gap, not a bug — see task notes).
// Fallback identity source #2, tried only after loadSharedViewer (above)
// comes up empty: this app's own long-lived `shared_session` cookie,
// self-issued via lib/sessionHandoff.js after redeeming a Command-minted
// SESSION handoff token (see that file's header). loadSharedViewer only
// recognizes a LIVE shared-Clerk credential — a Bearer header, or the
// shared instance's own short-lived __session cookie, which can't even be
// set cross-domain from Command's origin to Field's separate root domain
// anyway. This cookie is what makes that sign-in LAST beyond the ~60s a
// copied live token would, with no refresh mechanism on this side. Returns
// the same shape loadSharedViewer produces, minus name/image (the cookie
// carries only sub+email) — downstream code already handles a viewer with
// just userId/email.
function loadSharedSessionCookie(req) {
  const payload = verifySharedSessionCookie(req.cookies?.[SHARED_SESSION_COOKIE]);
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email, name: payload.email, image: null, _sharedInstance: true };
}

async function appAccessOrg(viewer, slug) {
  if (!slug) return null;
  const grant = (await getAppAccess(viewer.userId, slug)) || (await getAppAccess(viewer.userId, null));
  if (!grant) return null;
  const org = await store.getOrg(slug);
  if (!org) return null;
  return { id: org.id, slug: org.id, name: org.name, role: grant.role, feature_flags: org.feature_flags || {}, branding: org.branding || {}, plan: org.plan || 'starter' };
}

// Attach req.viewer and req.org for every route.
export async function resolveViewer(req, _res, next) {
  try {
    const slug = workspaceSlug(req);
    // Dev bypass — no Clerk, not prod.
    if (!clerkConfigured() && !isProd()) {
      req.viewer = { userId: 'dev-admin', email: 'dev@localhost', name: 'Dev Admin', role: 'org_admin', _dev: true };
      req.org = (await viewAsOrg(req, req.viewer))
        || (slug && await store.orgForUser('dev@localhost', slug))
        || (await store.orgForUser('dev@localhost'))
        || null;
      if (req.org?.role) req.viewer.role = req.org.role;
      await attachPerms(req);
      return next();
    }
    const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
    const userId = auth?.userId;
    // Identity source precedence: (1) this app's own Clerk instance
    // session, checked above via `userId`; (2) a LIVE shared-Clerk
    // credential (Phase C pilot, lib/dualAuth.js's loadSharedViewer — a
    // Bearer token or the shared instance's own short-lived __session
    // cookie); (3) this app's own long-lived `shared_session` cookie
    // (lib/sessionHandoff.js / loadSharedSessionCookie above), self-issued
    // after redeeming a Command SESSION handoff — never the reverse, and an
    // own-instance session always wins over both shared-instance sources
    // when present.
    let viewer, isSharedViewer = false;
    if (userId) {
      viewer = await loadClerkUser(userId);
    } else {
      const shared = await loadSharedViewer(req)
        // A live shared-Clerk credential (Bearer/__session) wins when present;
        // only when that's absent do we fall back to our own self-issued
        // long-lived cookie (see loadSharedSessionCookie's own comment).
        || loadSharedSessionCookie(req);
      if (shared) {
        isSharedViewer = true;
        viewer = { ...shared, role: adminEmails().includes(shared.email) ? 'org_admin' : 'dispatcher' };
      }
    }
    if (!viewer) { req.viewer = null; req.org = null; return next(); }
    req.viewer = viewer;
    // Precedence: (1) super-admin "view as" cookie, (2) URL-selected workspace
    // (membership-checked), (3) the caller's default membership, (4) — only
    // for a shared-Clerk viewer with none of the above — a Command-issued
    // app_access grant. Super-admins with no membership resolve to org:null
    // and are routed to /super-admin.
    req.org = viewer
      ? (await viewAsOrg(req, viewer))
        || (slug && await cachedOrgForUser(viewer.email, slug))
        || await cachedOrgForUser(viewer.email)
      : null;
    if (!req.org && isSharedViewer) req.org = await appAccessOrg(viewer, slug);
    // A member's effective role comes from their org membership, not Clerk
    // metadata (which invites never set).
    if (req.org?.role) req.viewer.role = req.org.role;
    await attachPerms(req);
    next();
  } catch {
    req.viewer = null; req.org = null; next();
  }
}

// Resolve the viewer's role to its capability + page sets and attach them as
// plain arrays (JSON-serializable for /api/me). Called once per request.
async function attachPerms(req) {
  if (!req.viewer) return;
  if (!req.org) { req.viewer.capabilities = []; req.viewer.pages = ['dashboard']; req.viewer.readPages = ['dashboard']; return; }
  const { pages, caps, readPages } = await resolveRolePerms(req.org.id, req.viewer.role);
  // Subtract anything a disabled workspace feature switches off. Because every
  // read route gates on readPages and every write on capabilities, stripping
  // here makes a disabled feature 403 server-side and vanish from the client's
  // nav/buttons at once — no per-route feature checks needed for page/cap
  // features (the page-less ones use requireFeature below).
  const flags = req.org.feature_flags || {};
  const offPages = new Set(disabledFeaturePages(flags));
  // Plan-tier caps (e.g. sso:write) are stripped the same way as a disabled
  // feature — a 'starter' workspace never sees them regardless of role.
  const offCaps = new Set([...disabledFeatureCaps(flags), ...enterpriseCaps(req.org.plan)]);
  req.viewer.capabilities = [...caps].filter((c) => !offCaps.has(c));
  req.viewer.pages = [...pages].filter((p) => !offPages.has(p));
  req.viewer.readPages = [...readPages].filter((p) => !offPages.has(p));
  // Region/team the member is scoped to (from their membership). Managers with
  // members:write see all regions; others with a region are restricted to it.
  req.viewer.region_id = req.org.region_id || null;
  req.viewer.team_id = req.org.team_id || null;
}

// Platform super-admin: an operator of Nexus Field itself (the /super-admin
// console). The dev-bypass admin is always a platform admin locally so the
// console is reachable with zero setup.
export const isPlatformAdmin = (viewer) => {
  if (!viewer) return false;
  if (viewer._dev) return true;
  const email = viewer.email?.toLowerCase();
  return !!email && platformAdminEmails().includes(email);
};
export const requirePlatformAdmin = (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!isPlatformAdmin(req.viewer)) return res.status(403).json({ error: 'Platform admin only' });
  next();
};

export const requireAuth = (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.org) return res.status(403).json({ error: 'No workspace membership' });
  next();
};

export const requireCapability = (cap) => (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.viewer.capabilities?.includes(cap)) {
    return res.status(403).json({ error: `Your role "${req.viewer.role}" cannot perform "${cap}"` });
  }
  next();
};

// Feature-gate: 403 unless the workspace has this feature active. Used for the
// few sub-features that own no page or capability of their own (payments, SMS,
// data export, the customer portal) — page/capability features are already
// enforced by the stripping in attachPerms.
export const requireFeature = (key) => (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.org || !featureActive(req.org.feature_flags, key)) {
    return res.status(403).json({ error: `The "${key}" feature is turned off for this workspace` });
  }
  next();
};

// Read-gate: 403 unless the viewer's role can VIEW this page. Applied to GET
// routes so page-level visibility is enforced server-side, not just hidden in nav.
export const requirePageView = (page) => (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.viewer.readPages?.includes(page)) {
    return res.status(403).json({ error: `Your role "${req.viewer.role}" cannot view "${page}"` });
  }
  next();
};
