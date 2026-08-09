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
import { randomUUID } from 'node:crypto';

import { store, clampLimit, orderCol, DEFAULT_LIMIT } from './lib/store.js';
import { isSupabaseConfigured } from './lib/db.js';
import { aiConfigured, streamAssist } from './lib/ai.js';
import { seedDemoInto } from './lib/demo.js';
import { runBackup } from './lib/backup.js';
import { generateDue } from './lib/maintenance.js';
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
// AI calls hit a paid third-party API — cap them tightly per IP.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
// Public customer portal — unauthenticated, so cap it tightly per IP.
const portalLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/api/uploads', uploadLimiter);
app.use('/api/ai', aiLimiter);
app.use('/api/portal', portalLimiter);

attachClerk(app);
app.use(resolveViewer);

// Express 4 doesn't catch rejected promises from async handlers — an
// uncaught rejection means the response never sends and the request hangs
// until the platform times out (504). wrap() forwards errors to the handler
// below so failures return 500 immediately.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Audit trail: record who did what. Fire-and-forget so it never blocks or breaks
// a request (and is a safe no-op before its migration is applied).
const audit = (req, action, entityType, entityId, summary, details = {}) => {
  if (!req.org?.id) return;
  Promise.resolve(store.insert('audit_log', req.org.id, {
    actor_email: req.viewer?.email || null, action, entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null, summary: summary || null, details,
  })).catch((e) => console.warn('[audit] skipped:', e?.message || e));
};

// --- Public customer portal (link-based, no login) ---
// The unguessable portal_token identifies the customer. Only that customer's
// own data is returned, and only safe fields (no internal costs/margins).
app.get('/api/portal/:token', wrap(async (req, res) => {
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const org = c.org_id;
  const [orgRow, sites, wos, invoices] = await Promise.all([
    store.getOrg(org),
    store.list('sites', org, { customer_id: c.id }),
    store.list('work_orders', org, { customer_id: c.id }),
    store.list('invoices', org, { customer_id: c.id }),
  ]);
  res.json({
    org: { name: orgRow?.name || 'Service' },
    customer: { id: c.id, name: c.name },
    sites: sites.map((s) => ({ id: s.id, name: s.name, address: s.address })),
    workOrders: wos.filter((w) => w.status !== 'cancelled').map((w) => ({
      number: w.number, title: w.title, status: w.status, priority: w.priority,
      scheduled_start: w.scheduled_start, sla_due: w.sla_due, created_at: w.created_at,
    })),
    invoices: invoices.filter((i) => i.status !== 'void').map((i) => ({
      number: i.number, issue_date: i.issue_date, due_date: i.due_date,
      total: i.total, amount_paid: i.amount_paid, status: i.status,
    })),
  });
}));

// A customer submits a service request from the portal → a new work order.
app.post('/api/portal/:token/requests', wrap(async (req, res) => {
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const org = c.org_id;
  const title = String(req.body?.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'A short description of the problem is required' });
  const priority = ['low', 'medium', 'high', 'urgent'].includes(req.body?.priority) ? req.body.priority : 'medium';
  let site_id = null;
  if (req.body?.site_id) {
    const sites = await store.list('sites', org, { customer_id: c.id });
    if (sites.some((s) => s.id === req.body.site_id)) site_id = req.body.site_id;
  }
  const existing = await store.list('work_orders', org);
  const wo = await store.insert('work_orders', org, {
    number: `WO-${String(existing.length + 1).padStart(4, '0')}`,
    customer_id: c.id, site_id, title,
    description: String(req.body?.description || '').slice(0, 4000),
    priority, status: 'requested',
    requested_by: String(req.body?.contact || '').slice(0, 120) || `${c.name} (portal)`,
    created_by: 'portal',
  });
  res.status(201).json({ ok: true, number: wo.number });
}));

// --- Identity: who am I, what workspace, what can I do ---
app.get('/api/health', (_req, res) => res.json({ ok: true, backend: isSupabaseConfigured() ? 'supabase' : 'memory' }));

// Daily automated backup — called by Vercel Cron. Authorized by CRON_SECRET
// (Vercel sends it as a Bearer token). Not a user endpoint.
app.get('/api/cron/backup', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  res.json(await runBackup());
}));

app.get('/api/me', requireAuth, (req, res) => {
  const caps = Object.keys(CAPABILITIES).filter((c) => can(req.viewer.role, c));
  // `ai` reports whether the assistant is actually available (key configured),
  // so the client can hide the feature entirely rather than offer a dead button.
  res.json({ viewer: req.viewer, org: req.org, capabilities: caps, features: { ai: aiConfigured() } });
});

app.get('/api/members', requireAuth, wrap(async (req, res) => {
  res.json(await store.listMembers(req.org.id));
}));

// Workspace settings (manager-only). Currently just the display name.
app.patch('/api/org', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const patch = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
  // Invoice template settings live under feature_flags.invoice (merged, so a
  // partial update doesn't clobber the rest of the flags).
  if (req.body?.invoice && typeof req.body.invoice === 'object') {
    const org = await store.getOrg(req.org.id);
    const ff = { ...(org?.feature_flags || {}) };
    ff.invoice = { ...(ff.invoice || {}), ...req.body.invoice };
    patch.feature_flags = ff;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  res.json(await store.updateOrg(req.org.id, patch));
}));

// One-shot dashboard aggregate — replaces 5 client round-trips with a single
// request whose queries run in parallel server-side.
app.get('/api/dashboard', requireAuth, wrap(async (req, res) => {
  const org = req.org.id;
  const OPEN_WO = ['requested', 'scheduled', 'en_route', 'on_site'];
  const [projects, punch, jobs, usage, workOrders, customers, invoices] = await Promise.all([
    store.list('projects', org), store.list('punch_items', org),
    store.list('jobs', org), store.list('item_usage', org),
    store.list('work_orders', org), store.list('customers', org),
    store.list('invoices', org),
  ]);
  const openWO = workOrders.filter((w) => OPEN_WO.includes(w.status));
  // Outstanding A/R = unpaid balance on issued (sent, not-yet-paid) invoices.
  const sentInvoices = invoices.filter((i) => i.status === 'sent');
  const outstanding = sentInvoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0);
  res.json({
    stats: {
      activeProjects: projects.filter((p) => p.status === 'active').length,
      totalProjects: projects.length,
      openPunch: punch.filter((p) => p.status !== 'done').length,
      totalPunch: punch.length,
      scheduledJobs: jobs.filter((j) => ['scheduled', 'en_route', 'in_progress'].includes(j.status)).length,
      materialCost: usage.reduce((s, u) => s + Number(u.unit_cost_at_use || 0) * Number(u.quantity || 0), 0),
      usageCount: usage.length,
      openWorkOrders: openWO.length,
      totalWorkOrders: workOrders.length,
      overdueWorkOrders: openWO.filter((w) => w.sla_due && new Date(w.sla_due) < new Date()).length,
      customers: customers.length,
      outstandingAR: outstanding,
      openInvoices: sentInvoices.length,
    },
    recentProjects: projects.slice(0, 5),
    upcomingJobs: jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled').slice(0, 5),
    openWorkOrders: openWO.slice(0, 5),
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
  audit(req, 'member', 'org_members', user_email, `Invited ${user_email} as ${role}`);

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
  audit(req, 'member', 'org_members', req.params.email, `Updated ${req.params.email}${role ? ` → ${role}` : ''}`);
  res.json(row);
}));

app.delete('/api/members/:email', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  // Guard against removing yourself — avoids locking the last manager out.
  if (req.params.email.toLowerCase() === req.viewer.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't remove yourself" });
  }
  const ok = await store.removeMember(req.org.id, req.params.email);
  if (ok) audit(req, 'member', 'org_members', req.params.email, `Removed ${req.params.email}`);
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

// --- AI assistant (optional; streams tokens over SSE) ---
// Advisory drafting only. Gated on the ai:use capability AND the key being
// configured. See the FTC AI disclosure in the Privacy Policy (/legal/privacy).
app.post('/api/ai/assist', requireAuth, requireCapability('ai:use'), async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI assistant is not configured' });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'A prompt is required' });
  const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 8000) : '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    for await (const chunk of streamAssist({ prompt, context })) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('event: done\ndata: {}\n\n');
  } catch (e) {
    console.error('[ai] stream failed:', e?.message || e);
    // If nothing has streamed yet the status is still mutable; otherwise emit an
    // in-band error event the client can surface.
    if (!res.headersSent) res.status(502).json({ error: e?.message || 'AI request failed' });
    else res.write(`event: error\ndata: ${JSON.stringify({ error: e?.message || 'AI request failed' })}\n\n`);
  } finally {
    res.end();
  }
});

// --- Generic org-scoped resource factory ---
// fields: allowlist of client-writable columns (org_id/id never included).
// ownerField: if set, stamped with the viewer's email on create.
// filters: query params that may narrow a list (e.g. ?project_id=...).
// beforeInsert: optional async (data, req) => void to derive server-side fields
//   (e.g. a sequential work-order number) before the row is written.
function resource(path, collection, writeCap, { fields, ownerField, filters = [], beforeInsert } = {}) {
  const pick = (body) => Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => fields.includes(k))
  );

  app.get(`/api/${path}`, requireAuth, wrap(async (req, res) => {
    const f = {};
    for (const key of filters) if (req.query[key]) f[key] = req.query[key];
    // Bounded, keyset-paginated. Default limit keeps every list query capped;
    // pass ?limit= (<=MAX) and ?before=<cursor> to page. The response stays a
    // plain array (no client change); the next cursor is an opt-in header.
    const limit = clampLimit(req.query.limit) ?? DEFAULT_LIMIT;
    const before = req.query.before || null;
    const rows = await store.list(collection, req.org.id, f, { limit, before });
    if (rows.length === limit) {
      const cursor = rows[rows.length - 1]?.[orderCol(collection)];
      if (cursor) res.setHeader('X-Next-Cursor', String(cursor));
    }
    res.json(rows);
  }));

  app.get(`/api/${path}/:id`, requireAuth, wrap(async (req, res) => {
    const row = await store.getById(collection, req.org.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  }));

  const labelOf = (r) => r?.number || r?.name || r?.title || r?.id;

  app.post(`/api/${path}`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const data = pick(req.body);
    if (ownerField) data[ownerField] = req.viewer.email;
    if (beforeInsert) await beforeInsert(data, req);
    const row = await store.insert(collection, req.org.id, data);
    audit(req, 'create', collection, row.id, `Created ${collection} ${labelOf(row)}`);
    res.status(201).json(row);
  }));

  app.patch(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const changes = pick(req.body);
    const row = await store.update(collection, req.org.id, req.params.id, changes);
    if (!row) return res.status(404).json({ error: 'Not found' });
    audit(req, 'update', collection, row.id, `Updated ${collection} ${labelOf(row)}`, { fields: Object.keys(changes) });
    res.json(row);
  }));

  app.delete(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const ok = await store.remove(collection, req.org.id, req.params.id);
    if (ok) audit(req, 'delete', collection, req.params.id, `Deleted ${collection} ${req.params.id}`);
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
  fields: ['job_id', 'work_order_id', 'clock_in', 'clock_out', 'notes'],
  ownerField: 'user_email',
  filters: ['job_id', 'work_order_id'],
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

// --- CRM spine: customers → sites → assets → work orders ---
resource('customers', 'customers', 'customers:write', {
  fields: ['name', 'billing_email', 'phone', 'billing_address', 'payment_terms', 'po_required', 'status', 'notes'],
  ownerField: 'created_by',
  filters: ['status'],
  beforeInsert: (data) => { if (!data.portal_token) data.portal_token = randomUUID(); },
});
// Rotate a customer's portal link (revokes the old one). Manager/accountant.
app.post('/api/customers/:id/portal-token', requireAuth, requireCapability('customers:write'), wrap(async (req, res) => {
  const row = await store.update('customers', req.org.id, req.params.id, { portal_token: randomUUID() });
  if (!row) return res.status(404).json({ error: 'Not found' });
  audit(req, 'update', 'customers', row.id, `Rotated portal link for ${row.name}`);
  res.json({ portal_token: row.portal_token });
}));
resource('sites', 'sites', 'sites:write', {
  fields: ['customer_id', 'name', 'address', 'access_notes', 'contact_name', 'contact_phone', 'status'],
  ownerField: 'created_by',
  filters: ['customer_id', 'status'],
});
resource('assets', 'assets', 'assets:write', {
  fields: ['customer_id', 'site_id', 'name', 'category', 'manufacturer', 'model', 'serial', 'install_date', 'warranty_expires', 'status', 'notes'],
  ownerField: 'created_by',
  filters: ['customer_id', 'site_id', 'status'],
});
resource('work-orders', 'work_orders', 'work_orders:write', {
  fields: ['customer_id', 'site_id', 'asset_id', 'title', 'description', 'priority', 'status', 'assignee_email', 'requested_by', 'sla_due', 'scheduled_start', 'scheduled_end', 'completed_at', 'resolution_notes', 'signature_url', 'signature_name'],
  ownerField: 'created_by',
  filters: ['customer_id', 'site_id', 'asset_id', 'status', 'assignee_email'],
  // Assign a per-org sequential WO number on create. Counting existing rows can
  // race under heavy concurrency, but at this scale a rare duplicate label is
  // cosmetic (the UUID id is always unique); good enough until we add a counter.
  beforeInsert: async (data, req) => {
    if (!data.number) {
      const existing = await store.list('work_orders', req.org.id);
      data.number = `WO-${String(existing.length + 1).padStart(4, '0')}`;
    }
  },
});
resource('work-order-lines', 'work_order_lines', 'wo_lines:write', {
  fields: ['work_order_id', 'kind', 'description', 'quantity', 'unit_cost', 'unit_price', 'item_id'],
  filters: ['work_order_id', 'kind'],
});

// --- Invoicing (the money loop) ---
resource('invoices', 'invoices', 'invoices:write', {
  fields: ['customer_id', 'work_order_id', 'status', 'issue_date', 'due_date', 'subtotal', 'tax_rate', 'tax_amount', 'total', 'amount_paid', 'notes'],
  ownerField: 'created_by',
  filters: ['customer_id', 'work_order_id', 'status'],
  beforeInsert: async (data, req) => {
    if (!data.number) {
      const existing = await store.list('invoices', req.org.id);
      data.number = `INV-${String(existing.length + 1).padStart(4, '0')}`;
    }
  },
});
resource('invoice-lines', 'invoice_lines', 'invoice_lines:write', {
  fields: ['invoice_id', 'description', 'quantity', 'unit_price', 'amount'],
  filters: ['invoice_id'],
});

// --- Recurring / preventive maintenance ---
resource('maintenance-plans', 'maintenance_plans', 'maintenance:write', {
  fields: ['customer_id', 'site_id', 'asset_id', 'title', 'description', 'priority', 'frequency', 'assignee_email', 'next_due', 'active'],
  ownerField: 'created_by',
  filters: ['customer_id', 'active'],
  beforeInsert: (data) => { if (data.active === undefined) data.active = true; },
});
// Generate work orders for all plans that are due now (manual trigger).
app.post('/api/maintenance/run', requireAuth, requireCapability('maintenance:write'), wrap(async (req, res) => {
  const result = await generateDue(req.org.id, req.viewer.email);
  if (result.created) audit(req, 'create', 'work_orders', null, `Generated ${result.created} maintenance work order(s)`);
  res.json(result);
}));
// Daily cron: generate due maintenance across every org (authorized by CRON_SECRET).
app.get('/api/cron/maintenance', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const client = db();
  if (!client) return res.json({ ok: false, skipped: 'supabase-not-configured' });
  const { data: orgs } = await client.from('orgs').select('id');
  let created = 0;
  for (const o of orgs || []) { created += (await generateDue(o.id, 'cron')).created; }
  res.json({ ok: true, created });
}));

// Payment terms → days until due. Drives the invoice due date from the customer.
const TERM_DAYS = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 };
const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Generate a draft invoice from a completed work order: snapshot its billable
// lines (so later WO edits don't change the invoice), set the due date from the
// customer's terms, apply an optional tax rate, and mark the WO invoiced.
app.post('/api/work-orders/:id/invoice', requireAuth, requireCapability('invoices:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const wo = await store.getById('work_orders', org, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const [woLines, customer, existing] = await Promise.all([
    store.list('work_order_lines', org, { work_order_id: wo.id }),
    wo.customer_id ? store.getById('customers', org, wo.customer_id) : Promise.resolve(null),
    store.list('invoices', org),
  ]);

  const subtotal = round2(woLines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0));
  const taxRate = Number(req.body?.tax_rate) || 0;
  const taxAmount = round2(subtotal * taxRate / 100);
  const total = round2(subtotal + taxAmount);
  const today = new Date().toISOString().slice(0, 10);
  const dueDays = TERM_DAYS[customer?.payment_terms] ?? 30;

  const invoice = await store.insert('invoices', org, {
    number: `INV-${String(existing.length + 1).padStart(4, '0')}`,
    customer_id: wo.customer_id || null, work_order_id: wo.id, status: 'draft',
    issue_date: today, due_date: addDays(today, dueDays),
    subtotal, tax_rate: taxRate, tax_amount: taxAmount, total, amount_paid: 0,
    notes: '', created_by: req.viewer.email,
  });
  for (const l of woLines) {
    await store.insert('invoice_lines', org, {
      invoice_id: invoice.id, description: l.description,
      quantity: l.quantity, unit_price: l.unit_price, amount: round2(Number(l.quantity) * Number(l.unit_price)),
    });
  }
  await store.update('work_orders', org, wo.id, { status: 'invoiced' });
  audit(req, 'invoice', 'invoices', invoice.id, `Generated ${invoice.number} from work order ${wo.number || wo.id}`, { total });
  res.status(201).json(invoice);
}));

// --- Shift clock (start/end of a worker's day) ---
const openShiftFor = async (org, email) =>
  (await store.list('shifts', org, { user_email: String(email).toLowerCase() }))
    .find((s) => !s.clock_out) || null;

app.get('/api/shifts', requireAuth, wrap(async (req, res) => {
  const f = {};
  if (req.query.user_email) f.user_email = String(req.query.user_email).toLowerCase();
  res.json(await store.list('shifts', req.org.id, f));
}));
app.get('/api/shifts/current', requireAuth, wrap(async (req, res) => {
  res.json({ shift: await openShiftFor(req.org.id, req.viewer.email) });
}));
app.post('/api/shifts/clock-in', requireAuth, requireCapability('time:write'), wrap(async (req, res) => {
  const open = await openShiftFor(req.org.id, req.viewer.email);
  if (open) return res.json({ shift: open });
  res.status(201).json({ shift: await store.insert('shifts', req.org.id, { user_email: req.viewer.email.toLowerCase(), clock_in: new Date().toISOString() }) });
}));
app.post('/api/shifts/clock-out', requireAuth, requireCapability('time:write'), wrap(async (req, res) => {
  const open = await openShiftFor(req.org.id, req.viewer.email);
  if (!open) return res.json({ shift: null });
  res.json({ shift: await store.update('shifts', req.org.id, open.id, { clock_out: new Date().toISOString() }) });
}));

// Timesheet correction requests (missed punches). Anyone with time:write can
// file one for themselves; a manager reviews it. Approval creates the shift.
resource('timesheet-requests', 'timesheet_requests', 'time:write', {
  fields: ['target_date', 'requested_clock_in', 'requested_clock_out', 'reason'],
  ownerField: 'user_email',
  filters: ['user_email', 'status'],
  beforeInsert: (data) => { data.status = 'pending'; },
});
app.post('/api/timesheet-requests/:id/review', requireAuth, requireCapability('timesheets:review'), wrap(async (req, res) => {
  const org = req.org.id;
  const reqRow = await store.getById('timesheet_requests', org, req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
  if (decision === 'approved') {
    await store.insert('shifts', org, { user_email: reqRow.user_email, clock_in: reqRow.requested_clock_in, clock_out: reqRow.requested_clock_out, note: `Corrected: ${reqRow.reason || ''}`.trim() });
  }
  const reviewed = await store.update('timesheet_requests', org, req.params.id, { status: decision, reviewed_by: req.viewer.email, reviewed_at: new Date().toISOString() });
  audit(req, 'review', 'timesheet_requests', req.params.id, `Timesheet correction ${decision} for ${reqRow.user_email}`);
  res.json(reviewed);
}));

// Audit log (manager-only). Paginated, newest first, filterable.
app.get('/api/audit-log', requireAuth, requireCapability('audit:read'), wrap(async (req, res) => {
  const f = {};
  for (const k of ['entity_type', 'entity_id', 'actor_email', 'action']) if (req.query[k]) f[k] = req.query[k];
  const limit = clampLimit(req.query.limit) ?? DEFAULT_LIMIT;
  const rows = await store.list('audit_log', req.org.id, f, { limit, before: req.query.before || null });
  if (rows.length === limit && rows[rows.length - 1]?.created_at) res.setHeader('X-Next-Cursor', String(rows[rows.length - 1].created_at));
  res.json(rows);
}));

// Manager sign-off: a work order isn't truly done until approved. Tech "Job
// complete" sets status=completed; this stamps the manager approval on top.
app.post('/api/work-orders/:id/approve', requireAuth, requireCapability('work_orders:approve'), wrap(async (req, res) => {
  const wo = await store.getById('work_orders', req.org.id, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const patch = { approved_at: new Date().toISOString(), approved_by: req.viewer.email };
  if (!['completed', 'invoiced'].includes(wo.status)) patch.status = 'completed';
  const updated = await store.update('work_orders', req.org.id, wo.id, patch);
  audit(req, 'approve', 'work_orders', wo.id, `Approved work order ${wo.number || wo.id}`);
  res.json(updated);
}));

// Load a coherent demo dataset (customers, sites, assets, work orders, a
// project + job). Manager-only, and idempotent — no-ops if the workspace
// already has customers, so it can't double-seed live data.
app.post('/api/demo-seed', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  res.json(await seedDemoInto(req.org.id, req.viewer.email));
}));

// Full workspace data export (backup / anti-lock-in). Manager-only. Returns a
// single JSON document of every table for this org.
app.get('/api/export', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const tables = ['projects', 'punch_items', 'service_offers', 'jobs', 'time_entries', 'items', 'item_usage', 'attachments',
    'customers', 'sites', 'assets', 'work_orders', 'work_order_lines', 'invoices', 'invoice_lines', 'maintenance_plans'];
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
