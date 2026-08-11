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
import { store } from './store.js';
import { CAPABILITIES, PRESET_ROLES, PAGE_KEYS, presetPerms, sanitizePerms, isRestrictedRole } from './permissions.js';

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
export async function resolveRolePerms(orgId, roleKey) {
  const preset = presetPerms(roleKey);
  if (preset) {
    // Legacy presets read every page; a RESTRICTED preset (technician) can only
    // read the pages it can see — its data is further self-scoped in server.js.
    const readPages = isRestrictedRole(roleKey) ? preset.pages : PAGE_KEYS;
    return { pages: new Set(preset.pages), caps: new Set(preset.caps), readPages: new Set(readPages) };
  }
  const key = `${orgId}:${roleKey}`;
  const hit = roleCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const row = await store.getRole(orgId, roleKey);
  const perms = sanitizePerms(row?.permissions || {});
  const data = { pages: new Set(perms.pages), caps: new Set(perms.caps), readPages: new Set(perms.pages) };
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
      ? 'manager_admin'
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
  const target = req.cookies?.view_as;
  if (!target || !isPlatformAdmin(viewer)) return null;
  const org = await store.getOrg(target);
  if (!org) return null;
  return { id: org.id, slug: org.id, name: org.name, role: 'manager_admin', feature_flags: org.feature_flags || {}, branding: org.branding || {}, viewingAs: true };
}

// Attach req.viewer and req.org for every route.
export async function resolveViewer(req, _res, next) {
  try {
    const slug = workspaceSlug(req);
    // Dev bypass — no Clerk, not prod.
    if (!clerkConfigured() && !isProd()) {
      req.viewer = { userId: 'dev-admin', email: 'dev@localhost', name: 'Dev Admin', role: 'manager_admin', _dev: true };
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
    if (!userId) { req.viewer = null; req.org = null; return next(); }
    const viewer = await loadClerkUser(userId);
    req.viewer = viewer;
    // Precedence: (1) super-admin "view as" cookie, (2) URL-selected workspace
    // (membership-checked), (3) the caller's default membership. Super-admins
    // with no membership resolve to org:null and are routed to /super-admin.
    req.org = viewer
      ? (await viewAsOrg(req, viewer))
        || (slug && await cachedOrgForUser(viewer.email, slug))
        || await cachedOrgForUser(viewer.email)
      : null;
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
  req.viewer.capabilities = [...caps];
  req.viewer.pages = [...pages];
  req.viewer.readPages = [...readPages];
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

// Read-gate: 403 unless the viewer's role can VIEW this page. Applied to GET
// routes so page-level visibility is enforced server-side, not just hidden in nav.
export const requirePageView = (page) => (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.viewer.readPages?.includes(page)) {
    return res.status(403).json({ error: `Your role "${req.viewer.role}" cannot view "${page}"` });
  }
  next();
};
