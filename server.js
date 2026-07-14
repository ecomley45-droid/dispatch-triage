import dotenv from 'dotenv';
// Clerk CLI writes keys to .env.local; load it first (wins), then .env fills gaps.
dotenv.config({ path: '.env.local' });
dotenv.config();
import * as Sentry from '@sentry/node';
// Initialize Sentry before other imports so it can instrument them. Inert
// (no-op) unless SENTRY_DSN is set.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', tracesSampleRate: 0.1 });
}
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { clerkClient } from '@clerk/express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { store } from './lib/store.js';
import { isSupabaseConfigured } from './lib/db.js';
import { uploadFile } from './lib/files.js';
import {
  attachClerk, assertProductionAuth, resolveViewer,
  requireAuth, requireCapability, can, CAPABILITIES, ROLES,
} from './lib/auth.js';

assertProductionAuth();

const app = express();
app.set('trust proxy', 1); // one hop: Vercel's proxy. Fixes req.ip + req.protocol.
const __dirname = dirname(fileURLToPath(import.meta.url));

// helmet sets HSTS, X-Content-Type-Options, frameguard, referrer policy, etc.
// CSP is left to vercel.json (which also covers the statically-served SPA).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '8mb' })); // headroom for base64 image uploads
app.use(cookieParser());

// Rate limiting: a general per-IP cap on the API, and a tighter one for the
// image-upload endpoint (base64 payloads are the most abusable).
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/api/uploads', uploadLimiter);

attachClerk(app);
app.use(resolveViewer);

// Express 4 doesn't catch rejected promises from async handlers — an
// uncaught rejection means the response never sends and the request hangs
// until the platform times out (504). wrap() forwards errors to the handler
// below so failures return 500 immediately.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Identity: who am I, what workspace, what can I do ---
app.get('/api/health', (_req, res) => res.json({ ok: true, backend: isSupabaseConfigured() ? 'supabase' : 'memory' }));

app.get('/api/me', requireAuth, (req, res) => {
  const caps = Object.keys(CAPABILITIES).filter((c) => can(req.viewer.role, c));
  res.json({ viewer: req.viewer, org: req.org, capabilities: caps });
});

app.get('/api/members', requireAuth, wrap(async (req, res) => {
  res.json(await store.listMembers(req.org.id));
}));

// One-shot dashboard aggregate — replaces 5 client round-trips with a single
// request whose queries run in parallel server-side.
app.get('/api/dashboard', requireAuth, wrap(async (req, res) => {
  const org = req.org.id;
  const [projects, punch, jobs, usage] = await Promise.all([
    store.list('projects', org), store.list('punch_items', org),
    store.list('jobs', org), store.list('item_usage', org),
  ]);
  res.json({
    stats: {
      activeProjects: projects.filter((p) => p.status === 'active').length,
      totalProjects: projects.length,
      openPunch: punch.filter((p) => p.status !== 'done').length,
      totalPunch: punch.length,
      scheduledJobs: jobs.filter((j) => ['scheduled', 'en_route', 'in_progress'].includes(j.status)).length,
      materialCost: usage.reduce((s, u) => s + Number(u.unit_cost_at_use || 0) * Number(u.quantity || 0), 0),
      usageCount: usage.length,
    },
    recentProjects: projects.slice(0, 5),
    upcomingJobs: jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled').slice(0, 5),
  });
}));

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Invite a member: pre-adds them to org_members with a role. They gain access
// on their first sign-in with that email (Microsoft or otherwise).
app.post('/api/members', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const { user_email, name, role } = req.body || {};
  if (!emailRe.test(user_email || '')) return res.status(400).json({ error: 'Valid email required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}` });
  const member = await store.addMember(req.org.id, { user_email, name, role });

  // Also send a Clerk invitation email with a signup link (non-fatal). Skipped
  // when Clerk isn't configured (local dev) or if the person is already invited.
  let invited = false;
  if (process.env.CLERK_SECRET_KEY) {
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    try {
      await clerkClient.invitations.createInvitation({
        emailAddress: String(user_email).toLowerCase(),
        redirectUrl: appUrl,
        publicMetadata: { role, org_id: req.org.id },
        ignoreExisting: true,
      });
      invited = true;
    } catch (e) {
      console.warn('[invite] Clerk invitation failed (member still added):', e?.errors?.[0]?.message || e.message);
    }
  }
  res.status(201).json({ member, invited });
}));

app.patch('/api/members/:email', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const { role, name } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: `Invalid role` });
  const row = await store.updateMember(req.org.id, req.params.email, { role, name });
  if (!row) return res.status(404).json({ error: 'Member not found' });
  res.json(row);
}));

app.delete('/api/members/:email', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  // Guard against removing yourself — avoids locking the last manager out.
  if (req.params.email.toLowerCase() === req.viewer.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't remove yourself" });
  }
  const ok = await store.removeMember(req.org.id, req.params.email);
  res.status(ok ? 204 : 404).end();
}));

// Image/file upload. Any member may upload; associating the returned URL with
// an entity is gated by that entity's own write capability. Body:
// { filename, contentType, data (base64, no data: prefix) } -> { url }.
app.post('/api/uploads', requireAuth, async (req, res) => {
  const { filename, contentType, data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Missing file data' });
  try {
    res.status(201).json(await uploadFile(req.org.id, { filename, contentType, data }));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// --- Generic org-scoped resource factory ---
// fields: allowlist of client-writable columns (org_id/id never included).
// ownerField: if set, stamped with the viewer's email on create.
// filters: query params that may narrow a list (e.g. ?project_id=...).
function resource(path, collection, writeCap, { fields, ownerField, filters = [] }) {
  const pick = (body) => Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => fields.includes(k))
  );

  app.get(`/api/${path}`, requireAuth, wrap(async (req, res) => {
    const f = {};
    for (const key of filters) if (req.query[key]) f[key] = req.query[key];
    res.json(await store.list(collection, req.org.id, f));
  }));

  app.get(`/api/${path}/:id`, requireAuth, wrap(async (req, res) => {
    const row = await store.getById(collection, req.org.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));

  app.post(`/api/${path}`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const data = pick(req.body);
    if (ownerField) data[ownerField] = req.viewer.email;
    res.status(201).json(await store.insert(collection, req.org.id, data));
  }));

  app.patch(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const row = await store.update(collection, req.org.id, req.params.id, pick(req.body));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));

  app.delete(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const ok = await store.remove(collection, req.org.id, req.params.id);
    res.status(ok ? 204 : 404).end();
  }));
}

resource('projects', 'projects', 'projects:write', {
  fields: ['name', 'client_name', 'location', 'status', 'budget', 'start_date', 'due_date', 'description'],
  ownerField: 'created_by',
});
resource('punch-items', 'punch_items', 'punch:write', {
  fields: ['project_id', 'title', 'description', 'status', 'priority', 'assignee_email', 'photo_url', 'completed_at'],
  ownerField: 'created_by',
  filters: ['project_id', 'status'],
});
resource('service-offers', 'service_offers', 'service:write', {
  fields: ['name', 'description', 'unit', 'default_rate', 'active'],
});
resource('jobs', 'jobs', 'jobs:write', {
  fields: ['project_id', 'service_offer_id', 'title', 'location', 'status', 'scheduled_start', 'scheduled_end', 'assignee_email', 'notes'],
  ownerField: 'dispatcher_email',
  filters: ['project_id', 'status', 'assignee_email'],
});
resource('time-entries', 'time_entries', 'time:write', {
  fields: ['job_id', 'clock_in', 'clock_out', 'notes'],
  ownerField: 'user_email',
  filters: ['job_id'],
});
resource('items', 'items', 'items:write', {
  fields: ['name', 'sku', 'image_url', 'unit', 'unit_cost'],
});
resource('item-usage', 'item_usage', 'usage:write', {
  fields: ['item_id', 'project_id', 'job_id', 'quantity', 'unit_cost_at_use', 'used_at', 'notes'],
  ownerField: 'recorded_by',
  filters: ['item_id', 'project_id', 'job_id'],
});
resource('attachments', 'attachments', 'attachments:write', {
  fields: ['entity_type', 'entity_id', 'url', 'kind', 'caption'],
  ownerField: 'created_by',
  filters: ['entity_type', 'entity_id', 'kind'],
});

// Full workspace data export (backup / anti-lock-in). Manager-only. Returns a
// single JSON document of every table for this org.
app.get('/api/export', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const tables = ['projects', 'punch_items', 'service_offers', 'jobs', 'time_entries', 'items', 'item_usage', 'attachments'];
  const data = {};
  await Promise.all(tables.map(async (t) => { data[t] = await store.list(t, org); }));
  res.setHeader('Content-Disposition', `attachment; filename="dispatch-export-${org}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exported_at: new Date().toISOString(), org: await store.getOrg(org), members: await store.listMembers(org), ...data });
}));

// --- Serve the built SPA in production ---
const dist = join(__dirname, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

// Report errors to Sentry (no-op unless SENTRY_DSN is set) before our handler.
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// Catch-all error handler: any error forwarded via wrap()/next() returns a
// clean 500 instead of hanging the request.
app.use((err, _req, res, _next) => {
  console.error('[api error]', err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message || 'Server error' });
});

// Export the Express app so the Vercel serverless entry (api/index.js) can
// invoke it. Only bind a port when running as a normal process (local dev,
// `npm run server`), not inside Vercel/Lambda.
export default app;

const inServerless = process.env.VERCEL || process.env.SERVERLESS || process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!inServerless) {
  const port = process.env.PORT || 5050;
  app.listen(port, () => {
    console.log(`Dispatch API on :${port} — data backend: ${isSupabaseConfigured() ? 'Supabase' : 'in-memory (demo)'}`);
  });
}
