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

export const ROLES = ['manager_admin', 'accountant_admin', 'dispatcher'];

// capability -> roles allowed to perform it. Reads are open to any member.
export const CAPABILITIES = {
  'projects:write': ['manager_admin'],
  'punch:write': ['manager_admin', 'dispatcher'],
  'service:write': ['manager_admin', 'accountant_admin'],
  'jobs:write': ['manager_admin', 'dispatcher'],
  'time:write': ['manager_admin', 'dispatcher'],
  'items:write': ['manager_admin', 'accountant_admin'],
  'usage:write': ['manager_admin', 'dispatcher', 'accountant_admin'],
  'members:write': ['manager_admin'],
};

export const can = (role, cap) => (CAPABILITIES[cap] || []).includes(role);

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

async function cachedOrgForUser(email) {
  const hit = orgCache.get(email);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = await store.orgForUser(email);
  orgCache.set(email, { data, exp: Date.now() + CACHE_MS });
  return data;
}

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

// Attach req.viewer and req.org for every route.
export async function resolveViewer(req, _res, next) {
  try {
    // Dev bypass — no Clerk, not prod.
    if (!clerkConfigured() && !isProd()) {
      req.viewer = { userId: 'dev-admin', email: 'dev@localhost', name: 'Dev Admin', role: 'manager_admin', _dev: true };
      req.org = (await store.orgForUser('dev@localhost')) || { id: 'family-dental', slug: 'family-dental', name: 'Family Dental Health', role: 'manager_admin', feature_flags: {} };
      return next();
    }
    const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
    const userId = auth?.userId;
    if (!userId) { req.viewer = null; req.org = null; return next(); }
    const viewer = await loadClerkUser(userId);
    req.viewer = viewer;
    req.org = viewer ? await cachedOrgForUser(viewer.email) : null;
    // Owner bootstrap: an ADMIN_EMAILS user who isn't a member of any org yet
    // gets Manager Admin of the default workspace, so the first login lands in
    // the app instead of a "no membership" wall. Everyone else must be invited.
    if (!req.org && viewer && adminEmails().includes(viewer.email)) {
      const org = (await store.getOrg('family-dental')) || { id: 'family-dental', name: 'Family Dental Health', feature_flags: {} };
      req.org = { id: org.id, slug: org.id, name: org.name, role: 'manager_admin', feature_flags: org.feature_flags || {} };
    }
    // A member's effective role comes from their org membership, not Clerk
    // metadata (which invites never set).
    if (req.org?.role) req.viewer.role = req.org.role;
    next();
  } catch {
    req.viewer = null; req.org = null; next();
  }
}

export const requireAuth = (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!req.org) return res.status(403).json({ error: 'No workspace membership' });
  next();
};

export const requireCapability = (cap) => (req, res, next) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  if (!can(req.viewer.role, cap)) {
    return res.status(403).json({ error: `Your role "${req.viewer.role}" cannot perform "${cap}"` });
  }
  next();
};
