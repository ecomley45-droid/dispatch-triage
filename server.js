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
import { paymentsEnabled, createCheckout, verifyWebhook, createBillingPortalSession } from './lib/payments.js';
import { smsEnabled, sendSMS } from './lib/notify.js';
import { emailEnabled, sendEmail } from './lib/email.js';
import { encryptSecret, secretsConfigured } from './lib/crypto.js';
import { INTACCT_FIELDS, resolveIntacctConfig, testIntacct } from './lib/intacct.js';
import { uploadFile } from './lib/files.js';
import {
  attachClerk, assertProductionAuth, resolveViewer,
  requireAuth, requireCapability, requirePageView, requirePlatformAdmin, isPlatformAdmin,
} from './lib/auth.js';
import { PAGES, PRESET_ROLES, ROLE_LABEL, COLLECTION_PAGE, presetPerms, sanitizePerms, isRestrictedRole } from './lib/permissions.js';
import { computeOverview } from './lib/ownerStats.js';
import { computeReport } from './lib/reports.js';

assertProductionAuth();

const app = express();
app.set('trust proxy', 1); // one hop: Vercel's proxy. Fixes req.ip + req.protocol.
const __dirname = dirname(fileURLToPath(import.meta.url));

// helmet sets HSTS, X-Content-Type-Options, frameguard, referrer policy, etc.
// CSP is left to vercel.json (which also covers the statically-served SPA).
app.use(helmet({ contentSecurityPolicy: false }));
// Keep the raw body around (Stripe webhook signature is computed over it).
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
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
const now = () => new Date().toISOString();

// Audit trail: record who did what. Fire-and-forget so it never blocks or breaks
// a request (and is a safe no-op before its migration is applied).
const audit = (req, action, entityType, entityId, summary, details = {}) => {
  if (!req.org?.id) return;
  Promise.resolve(store.insert('audit_log', req.org.id, {
    actor_email: req.viewer?.email || null, action, entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null, summary: summary || null, details,
  })).catch((e) => console.warn('[audit] skipped:', e?.message || e));
};

// --- In-app notifications ---
// Delivery types the user can toggle (default on). Kept here so the settings UI
// and the emit points share one list.
const NOTIF_TYPES = {
  wo_assignment: 'When a work order is assigned to me',
  ticket_message: 'When a customer sends a portal ticket message',
};
// Create one notification for a recipient, honoring their opt-out preference.
// Fire-and-forget: never throws into the caller's request path.
async function notifyUser(orgId, email, type, { title, body, link } = {}) {
  if (!orgId || !email) return;
  try {
    const prefs = await store.getNotifPrefs(orgId, email);
    if (prefs?.[type] === false) return; // explicitly opted out
    await store.insert('notifications', orgId, {
      user_email: String(email).toLowerCase(), type, title,
      body: body || null, link: link || null,
    });
  } catch (e) { console.warn('[notify] skipped:', e?.message || e); }
}
// Notify the right staff about a customer ticket message: the assignee if set,
// otherwise every member of the workspace (each respects their own preference).
async function notifyTicketStaff(orgId, ticket, preview) {
  const title = `New message on ${ticket.number || 'a ticket'}`;
  const payload = { title, body: `${ticket.subject}: ${String(preview).slice(0, 140)}`, link: '/tickets' };
  if (ticket.assignee_email) return notifyUser(orgId, ticket.assignee_email, 'ticket_message', payload);
  const members = await store.listMembers(orgId).catch(() => []);
  await Promise.all(members.map((m) => notifyUser(orgId, m.user_email, 'ticket_message', payload)));
}

// --- Public customer portal (link-based, no login) ---
// The unguessable portal_token identifies the customer. Only that customer's
// own data is returned, and only safe fields (no internal costs/margins).
app.get('/api/portal/:token', wrap(async (req, res) => {
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const org = c.org_id;
  const [orgRow, sites, wos, invoices, tickets] = await Promise.all([
    store.getOrg(org),
    store.list('sites', org, { customer_id: c.id }),
    store.list('work_orders', org, { customer_id: c.id }),
    store.list('invoices', org, { customer_id: c.id }),
    store.list('tickets', org, { customer_id: c.id }),
  ]);
  const siteName = (id) => sites.find((s) => s.id === id)?.name || null;
  // Attach each ticket's message thread (portal-safe fields only).
  const withMsgs = await Promise.all(tickets.map(async (t) => {
    const msgs = await store.list('ticket_messages', org, { ticket_id: t.id });
    return {
      id: t.id, number: t.number, subject: t.subject, status: t.status,
      work_order_number: t.work_order_id ? (wos.find((w) => w.id === t.work_order_id)?.number || null) : null,
      last_message_at: t.last_message_at, created_at: t.created_at,
      messages: msgs
        .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((m) => ({ id: m.id, author_type: m.author_type, author_name: m.author_type === 'staff' ? (orgRow?.name || 'Support') : (m.author_name || c.name), body: m.body, created_at: m.created_at })),
    };
  }));
  res.json({
    org: { name: orgRow?.name || 'Service', payments: paymentsEnabled() },
    customer: { id: c.id, name: c.name },
    sites: sites.map((s) => ({ id: s.id, name: s.name, address: s.address })),
    workOrders: wos.filter((w) => w.status !== 'cancelled').map((w) => ({
      id: w.id, number: w.number, title: w.title, description: w.description || '',
      status: w.status, priority: w.priority, site_name: siteName(w.site_id),
      scheduled_start: w.scheduled_start, scheduled_end: w.scheduled_end, sla_due: w.sla_due,
      completed_at: w.completed_at, resolution_notes: w.status === 'cancelled' ? '' : (w.resolution_notes || ''),
      created_at: w.created_at,
    })),
    invoices: invoices.filter((i) => i.status !== 'void').map((i) => ({
      number: i.number, issue_date: i.issue_date, due_date: i.due_date,
      total: i.total, amount_paid: i.amount_paid, status: i.status,
    })),
    tickets: withMsgs.sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at))),
  });
}));

// --- Customer portal: open a ticket / reply to one (link-scoped, no login) ---
const nextTicketNumber = async (org) => `TK-${String((await store.list('tickets', org)).length + 1).padStart(4, '0')}`;

app.post('/api/portal/:token/tickets', wrap(async (req, res) => {
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const org = c.org_id;
  const subject = String(req.body?.subject || '').trim().slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!subject || !body) return res.status(400).json({ error: 'A subject and a message are required' });
  const name = String(req.body?.contact || '').trim().slice(0, 120) || c.name;
  let work_order_id = null;
  if (req.body?.work_order_id) {
    const w = await store.getById('work_orders', org, req.body.work_order_id);
    if (w && w.customer_id === c.id) work_order_id = w.id;
  }
  const ticket = await store.insert('tickets', org, {
    number: await nextTicketNumber(org), customer_id: c.id, work_order_id, subject,
    status: 'open', priority: 'medium', last_message_at: now(), created_by: 'portal',
  });
  await store.insert('ticket_messages', org, { ticket_id: ticket.id, author_type: 'customer', author_name: name, body });
  notifyTicketStaff(org, ticket, body).catch(() => {});
  res.status(201).json({ ok: true, id: ticket.id, number: ticket.number });
}));

app.post('/api/portal/:token/tickets/:id/messages', wrap(async (req, res) => {
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const org = c.org_id;
  const t = await store.getById('tickets', org, req.params.id);
  if (!t || t.customer_id !== c.id) return res.status(404).json({ error: 'Ticket not found' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'A message is required' });
  const name = String(req.body?.contact || '').trim().slice(0, 120) || c.name;
  await store.insert('ticket_messages', org, { ticket_id: t.id, author_type: 'customer', author_name: name, body });
  await store.update('tickets', org, t.id, { last_message_at: now(), status: t.status === 'closed' ? 'open' : 'pending' });
  notifyTicketStaff(org, t, body).catch(() => {});
  res.status(201).json({ ok: true });
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

// Stripe webhook — marks an invoice paid when its checkout completes. Verified
// against the raw body; no auth (Stripe calls it). No-op without the secret.
app.post('/api/stripe/webhook', wrap(async (req, res) => {
  const event = verifyWebhook(req.rawBody, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return res.status(400).json({ error: 'Invalid signature' });
  if (event.type === 'checkout.session.completed') {
    const m = event.data?.object?.metadata || {};
    if (m.kind === 'invoice' && m.org_id && m.invoice_id) {
      const inv = await store.getById('invoices', m.org_id, m.invoice_id);
      if (inv && inv.status !== 'paid') {
        await store.update('invoices', m.org_id, m.invoice_id, { amount_paid: inv.total, status: 'paid' });
        await store.insert('audit_log', m.org_id, { actor_email: 'stripe', action: 'pay', entity_type: 'invoices', entity_id: String(m.invoice_id), summary: `Invoice ${inv.number} paid online`, details: {} }).catch(() => {});
      }
    }
  }
  res.json({ received: true });
}));

const appOrigin = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

// Customer pays an invoice from the portal (link-scoped, no login).
app.post('/api/portal/:token/pay', wrap(async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Online payments are not enabled' });
  const c = await store.customerByPortalToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  const inv = (await store.list('invoices', c.org_id, { customer_id: c.id })).find((i) => i.number === req.body?.number);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid || 0)) * 100);
  if (balance <= 0) return res.status(400).json({ error: 'Nothing due on this invoice' });
  const url = appOrigin(req);
  const session = await createCheckout({
    amountCents: balance, name: `Invoice ${inv.number}`,
    successUrl: `${url}/portal/${req.params.token}?paid=1`, cancelUrl: `${url}/portal/${req.params.token}`,
    metadata: { kind: 'invoice', org_id: c.org_id, invoice_id: inv.id },
  });
  res.json({ url: session.url });
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

// /api/me only needs a signed-in viewer — org may be null (super-admins often
// have no workspace of their own). The client uses isSuperAdmin + memberships to
// route: super-admin → /super-admin, member → their workspace.
app.get('/api/me', wrap(async (req, res) => {
  if (!req.viewer) return res.status(401).json({ error: 'Authentication required' });
  const memberships = await store.listMembershipsForUser(req.viewer.email).catch(() => []);
  const superAdmin = isPlatformAdmin(req.viewer);
  res.json({
    viewer: req.viewer, org: req.org, memberships,
    capabilities: req.viewer.capabilities || [], pages: req.viewer.pages || [],
    isSuperAdmin: superAdmin, platformAdmin: superAdmin,
    features: { ai: aiConfigured(), payments: paymentsEnabled(), sms: smsEnabled() },
  });
}));

app.get('/api/members', requireAuth, requirePageView('team'), wrap(async (req, res) => {
  res.json(await store.listMembers(req.org.id));
}));

// --- Roles: built-in presets + custom per-workspace roles ---
const roleSlug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const roleView = (r) => ({ key: r.key, name: r.name, permissions: sanitizePerms(r.permissions || {}), preset: false, default_region_id: r.default_region_id || null });
// The full role list = built-in presets (with any stored name/default-region
// override merged in) + custom roles. A stored row for a preset key holds only
// its overridden name/default region; its permissions always come from code.
async function allRoles(orgId) {
  const stored = await store.listRoles(orgId);
  const byKey = Object.fromEntries(stored.map((r) => [r.key, r]));
  const presets = PRESET_ROLES.map((k) => {
    const o = byKey[k];
    return { key: k, name: o?.name || ROLE_LABEL[k] || k, permissions: presetPerms(k), preset: true, default_region_id: o?.default_region_id || null };
  });
  const customs = stored.filter((r) => !PRESET_ROLES.includes(r.key)).map(roleView);
  return [...presets, ...customs];
}
// A role key is assignable to a member if it's a preset or a custom role in the org.
const assignableRole = async (orgId, key) => !!key && (PRESET_ROLES.includes(key) || !!(await store.getRole(orgId, key)));
// A role's default region (custom roles or a preset override row), used to
// auto-assign a region to new members created with that role.
const roleDefaultRegion = async (orgId, key) => (await store.getRole(orgId, key).catch(() => null))?.default_region_id || null;

// Any member may read the role list (Team + Settings render assignments/labels).
app.get('/api/roles', requireAuth, wrap(async (req, res) => {
  res.json(await allRoles(req.org.id));
}));

app.post('/api/roles', requireAuth, requireCapability('roles:write'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Role name is required' });
  const key = roleSlug(req.body?.key || name);
  if (!key) return res.status(400).json({ error: 'Could not derive a valid role key from the name' });
  if (PRESET_ROLES.includes(key)) return res.status(409).json({ error: `"${key}" is a reserved built-in role` });
  if (await store.getRole(req.org.id, key)) return res.status(409).json({ error: `Role "${key}" already exists` });
  const permissions = sanitizePerms(req.body?.permissions || {});
  const default_region_id = req.body?.default_region_id || null;
  const row = await store.createRole(req.org.id, { key, name, permissions, default_region_id });
  audit(req, 'create', 'roles', key, `Created role ${name}`);
  res.status(201).json(roleView(row));
}));

app.patch('/api/roles/:key', requireAuth, requireCapability('roles:write'), wrap(async (req, res) => {
  const key = req.params.key;
  const name = (typeof req.body?.name === 'string' && req.body.name.trim()) ? req.body.name.trim() : undefined;
  const hasRegion = req.body && Object.prototype.hasOwnProperty.call(req.body, 'default_region_id');
  const default_region_id = hasRegion ? (req.body.default_region_id || null) : undefined;

  // Built-in roles: only the display name and default region are overridable —
  // permissions stay code-defined. A stored row carries just those overrides.
  if (PRESET_ROLES.includes(key)) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (default_region_id !== undefined) patch.default_region_id = default_region_id;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    const row = await store.setRoleMeta(req.org.id, key, patch);
    audit(req, 'update', 'roles', key, `Updated built-in role ${row.name || key}`);
    return res.json({ key, name: row.name || ROLE_LABEL[key] || key, permissions: presetPerms(key), preset: true, default_region_id: row.default_region_id || null });
  }

  const patch = {};
  if (name !== undefined) patch.name = name;
  if (req.body?.permissions && typeof req.body.permissions === 'object') patch.permissions = sanitizePerms(req.body.permissions);
  if (default_region_id !== undefined) patch.default_region_id = default_region_id;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const row = await store.updateRole(req.org.id, key, patch);
  if (!row) return res.status(404).json({ error: 'Role not found' });
  audit(req, 'update', 'roles', key, `Updated role ${row.name}`);
  res.json(roleView(row));
}));

app.delete('/api/roles/:key', requireAuth, requireCapability('roles:write'), wrap(async (req, res) => {
  if (PRESET_ROLES.includes(req.params.key)) return res.status(400).json({ error: 'Built-in roles cannot be deleted' });
  const members = await store.listMembers(req.org.id);
  if (members.some((m) => m.role === req.params.key)) {
    return res.status(409).json({ error: 'This role is still assigned to members — reassign them first.' });
  }
  const ok = await store.deleteRole(req.org.id, req.params.key);
  if (ok) audit(req, 'delete', 'roles', req.params.key, `Deleted role ${req.params.key}`);
  res.json({ removed: ok });
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
  // Outbound email sender (per workspace, used for ticket replies).
  if (req.body?.email && typeof req.body.email === 'object') {
    const org = await store.getOrg(req.org.id);
    const ff = patch.feature_flags || { ...(org?.feature_flags || {}) };
    const e = req.body.email;
    ff.email = {
      ...(ff.email || {}),
      ...(typeof e.from === 'string' ? { from: e.from.trim() } : {}),
      ...(typeof e.fromName === 'string' ? { fromName: e.fromName.trim() } : {}),
      ...(typeof e.replyTo === 'string' ? { replyTo: e.replyTo.trim() } : {}),
    };
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

// ---------------------------------------------------------------------------
// Nexus Super Admin — platform operator console (/super-admin).
// Every route here is gated by requirePlatformAdmin and takes the target org
// from the path (never req.org). These operate ACROSS workspaces.
// ---------------------------------------------------------------------------
// Super-admin routes require a super-admin viewer but NOT a workspace membership
// (operators often have no org of their own). requirePlatformAdmin already
// checks the viewer without touching req.org.
const superOnly = [requirePlatformAdmin];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// --- "View as" impersonation: a super-admin opens any workspace as an admin ---
// The httpOnly cookie is the source of truth (see resolveViewer.viewAsOrg).
// Deliberately writes NO audit entry.
const VIEW_AS_MAX_AGE = 4 * 60 * 60 * 1000; // 4h
app.post('/api/super/view-as/:orgId', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  res.cookie('view_as', org.id, { httpOnly: true, sameSite: 'lax', secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production', maxAge: VIEW_AS_MAX_AGE, path: '/' });
  res.json({ ok: true, org: { id: org.id, name: org.name } });
}));
app.post('/api/super/view-as/clear', superOnly, (req, res) => {
  res.clearCookie('view_as', { path: '/' });
  res.json({ ok: true });
});

// Load one workspace's executive overview (same metrics the old /owner used).
async function orgOverview(orgId) {
  const [invoices, workOrders, lines, timeEntries, customers, plans] = await Promise.all([
    store.list('invoices', orgId), store.list('work_orders', orgId), store.list('work_order_lines', orgId),
    store.list('time_entries', orgId), store.list('customers', orgId), store.list('maintenance_plans', orgId),
  ]);
  return computeOverview({ invoices, workOrders, lines, timeEntries, customers, plans, now: Date.now() });
}

// Public shape of an org for the console (never leak raw Stripe ids beyond what's needed).
const orgPublic = (o) => o && ({
  id: o.id, name: o.name, plan: o.plan, branding: o.branding || {}, feature_flags: o.feature_flags || {},
  subscription_status: o.subscription_status || null, billing_email: o.billing_email || null,
  has_stripe_customer: !!o.stripe_customer_id,
  member_count: o.member_count, created_at: o.created_at, updated_at: o.updated_at,
});

app.get('/api/super/me', superOnly, (req, res) => {
  res.json({ viewer: req.viewer, platformAdmin: true, features: { payments: paymentsEnabled() } });
});

app.get('/api/super/orgs', superOnly, wrap(async (_req, res) => {
  const orgs = await store.listOrgs();
  res.json(orgs.map(orgPublic));
}));

app.post('/api/super/orgs', superOnly, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Workspace name is required' });
  const id = slugify(req.body?.id || name);
  if (!id) return res.status(400).json({ error: 'Could not derive a valid workspace id from the name' });
  if (await store.getOrg(id)) return res.status(409).json({ error: `Workspace "${id}" already exists` });
  const plan = typeof req.body?.plan === 'string' ? req.body.plan : 'starter';
  const first_admin_email = req.body?.first_admin_email ? String(req.body.first_admin_email).toLowerCase().trim() : null;
  const branding = req.body?.branding && typeof req.body.branding === 'object' ? req.body.branding : {};
  const org = await store.createOrg({ id, name, plan, branding, first_admin_email });
  res.status(201).json(orgPublic({ ...org, member_count: first_admin_email ? 1 : 0 }));
}));

app.get('/api/super/orgs/:id', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  const members = await store.listMembers(org.id);
  const roles = await allRoles(org.id);
  res.json({ ...orgPublic({ ...org, member_count: members.length }), members, roles });
}));

app.patch('/api/super/orgs/:id', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  const patch = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
  if (typeof req.body?.plan === 'string' && req.body.plan.trim()) patch.plan = req.body.plan.trim();
  if (typeof req.body?.subscription_status === 'string') patch.subscription_status = req.body.subscription_status || null;
  if (typeof req.body?.billing_email === 'string') patch.billing_email = req.body.billing_email.trim() || null;
  // Branding is merged so a partial save (e.g. only a color) keeps the rest.
  if (req.body?.branding && typeof req.body.branding === 'object') {
    patch.branding = { ...(org.branding || {}), ...req.body.branding };
  }
  // Feature/integration flags, merged one level deep so a partial toggle keeps
  // the rest ({ features: {...}, integrations: {...} }).
  if (req.body?.feature_flags && typeof req.body.feature_flags === 'object') {
    const ff = { ...(org.feature_flags || {}) };
    for (const [k, v] of Object.entries(req.body.feature_flags)) {
      ff[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(ff[k] || {}), ...v } : v;
    }
    patch.feature_flags = ff;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  res.json(orgPublic(await store.updateOrg(org.id, patch)));
}));

app.get('/api/super/orgs/:id/overview', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  res.json(await orgOverview(org.id));
}));

// Seed demo data into a specific workspace — a creator tool (moved off the
// client Settings page).
app.post('/api/super/orgs/:id/demo-seed', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  res.json(await seedDemoInto(org.id, req.viewer.email));
}));

// Cross-workspace member management.
app.post('/api/super/orgs/:id/members', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  const email = String(req.body?.user_email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const role = (await assignableRole(org.id, req.body?.role)) ? req.body.role : 'dispatcher';
  res.status(201).json(await store.addMember(org.id, { user_email: email, name: req.body?.name || null, role }));
}));

app.patch('/api/super/orgs/:id/members/:email', superOnly, wrap(async (req, res) => {
  const patch = {};
  if (await assignableRole(req.params.id, req.body?.role)) patch.role = req.body.role;
  if (typeof req.body?.name === 'string') patch.name = req.body.name;
  const updated = await store.updateMember(req.params.id, req.params.email, patch);
  if (!updated) return res.status(404).json({ error: 'Member not found' });
  res.json(updated);
}));

app.delete('/api/super/orgs/:id/members/:email', superOnly, wrap(async (req, res) => {
  const ok = await store.removeMember(req.params.id, req.params.email);
  res.json({ removed: ok });
}));

// Open a Stripe billing portal session for a workspace (requires a saved
// Stripe customer id and STRIPE_SECRET_KEY). Returns the hosted URL.
app.post('/api/super/orgs/:id/billing/portal', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  if (!paymentsEnabled()) return res.status(400).json({ error: 'Payments are not configured (set STRIPE_SECRET_KEY).' });
  if (!org.stripe_customer_id) return res.status(400).json({ error: 'This workspace has no Stripe customer on file yet.' });
  const returnUrl = req.body?.return_url || `${req.protocol}://${req.get('host')}/super-admin/workspaces/${org.id}`;
  const { url } = await createBillingPortalSession({ customerId: org.stripe_customer_id, returnUrl });
  res.json({ url });
}));

// Date-range financial report + export data (owner + accounting).
app.get('/api/reports', requireAuth, requireCapability('reports:read'), wrap(async (req, res) => {
  const org = req.org.id;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : monthStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const [invoices, workOrders, lines, timeEntries, customers] = await Promise.all([
    store.list('invoices', org), store.list('work_orders', org), store.list('work_order_lines', org),
    store.list('time_entries', org), store.list('customers', org),
  ]);
  res.json(computeReport({ invoices, workOrders, lines, timeEntries, customers, from, to }));
}));

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Invite a member: pre-adds them to org_members with a role. They gain access
// on their first sign-in with that email (Microsoft or otherwise).
app.post('/api/members', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const { user_email, name, role, team_id } = req.body || {};
  if (!emailRe.test(user_email || '')) return res.status(400).json({ error: 'Valid email required' });
  if (!(await assignableRole(req.org.id, role))) return res.status(400).json({ error: 'Unknown role' });
  // Region: explicit choice wins; otherwise inherit the role's default region.
  let region_id = req.body?.region_id || null;
  if (!region_id) region_id = (await roleDefaultRegion(req.org.id, role)) || null;
  const member = await store.addMember(req.org.id, { user_email, name, role, region_id, team_id: team_id || null });
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
  if (role !== undefined && !(await assignableRole(req.org.id, role))) return res.status(400).json({ error: `Invalid role` });
  const patch = { role, name };
  if ('region_id' in (req.body || {})) patch.region_id = req.body.region_id || null;
  if ('team_id' in (req.body || {})) patch.team_id = req.body.team_id || null;
  const row = await store.updateMember(req.org.id, req.params.email, patch);
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

// --- Notifications (per-user; the bell) ---
app.get('/api/notifications', requireAuth, wrap(async (req, res) => {
  const email = req.viewer.email.toLowerCase();
  const limit = clampLimit(req.query.limit) ?? DEFAULT_LIMIT;
  const rows = (await store.list('notifications', req.org.id, { user_email: email }, { limit: null }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ notifications: rows.slice(0, limit), unread: rows.filter((n) => !n.read_at).length });
}));

app.post('/api/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  const n = await store.getById('notifications', req.org.id, req.params.id);
  if (!n || n.user_email !== req.viewer.email.toLowerCase()) return res.status(404).json({ error: 'Not found' });
  res.json(await store.update('notifications', req.org.id, n.id, { read_at: now() }));
}));

app.post('/api/notifications/read-all', requireAuth, wrap(async (req, res) => {
  const email = req.viewer.email.toLowerCase();
  const rows = await store.list('notifications', req.org.id, { user_email: email }, { limit: null });
  await Promise.all(rows.filter((n) => !n.read_at).map((n) => store.update('notifications', req.org.id, n.id, { read_at: now() })));
  res.json({ ok: true });
}));

// Per-user notification preferences (merged over the defaults = all on).
app.get('/api/notification-prefs', requireAuth, wrap(async (req, res) => {
  const saved = await store.getNotifPrefs(req.org.id, req.viewer.email);
  const prefs = {};
  for (const t of Object.keys(NOTIF_TYPES)) prefs[t] = saved?.[t] !== false;
  res.json({ types: NOTIF_TYPES, prefs });
}));

app.patch('/api/notification-prefs', requireAuth, wrap(async (req, res) => {
  const saved = { ...(await store.getNotifPrefs(req.org.id, req.viewer.email)) };
  for (const [t, v] of Object.entries(req.body?.prefs || {})) {
    if (t in NOTIF_TYPES) saved[t] = !!v;
  }
  await store.setNotifPrefs(req.org.id, req.viewer.email, saved);
  const prefs = {};
  for (const t of Object.keys(NOTIF_TYPES)) prefs[t] = saved?.[t] !== false;
  res.json({ types: NOTIF_TYPES, prefs });
}));

// --- Integrations: Sage Intacct (per-workspace, encrypted secrets) ---
// Whether a workspace MAY use an integration is set by the Super Admin in
// orgs.feature_flags.integrations. The workspace configures its own credentials
// here (manager-only). Secret fields are encrypted at rest and never returned.
const integrationAllowed = (org, provider) => {
  const flags = org?.feature_flags?.integrations;
  return !flags || flags[provider] !== false; // default-allowed unless explicitly off
};
// Present the stored config to the client: non-secret values verbatim, secrets
// replaced by a boolean "is one saved?" so the browser never sees a credential.
const intacctClientConfig = (row) => {
  const c = row?.config || {};
  const out = {};
  for (const [k, f] of Object.entries(INTACCT_FIELDS)) out[k] = f.secret ? { saved: !!c[k] } : (c[k] || '');
  return out;
};

app.get('/api/integrations/intacct', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const org = await store.getOrg(req.org.id);
  const row = await store.getIntegration(req.org.id, 'intacct');
  res.json({
    available: integrationAllowed(org, 'intacct'),
    enabled: !!row?.enabled,
    fields: Object.fromEntries(Object.entries(INTACCT_FIELDS).map(([k, f]) => [k, { label: f.label, secret: f.secret }])),
    config: intacctClientConfig(row),
    secretsConfigured: secretsConfigured(),
  });
}));

app.patch('/api/integrations/intacct', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const org = await store.getOrg(req.org.id);
  if (!integrationAllowed(org, 'intacct')) return res.status(403).json({ error: 'This integration is not enabled for your workspace.' });
  const cur = await store.getIntegration(req.org.id, 'intacct');
  const config = { ...(cur?.config || {}) };
  const body = req.body?.config || {};
  for (const [k, f] of Object.entries(INTACCT_FIELDS)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (f.secret) {
      // Only rewrite a secret when a new non-empty value is supplied; an empty
      // string means "clear it", undefined/absent means "leave as-is".
      if (v === '') delete config[k];
      else if (typeof v === 'string' && v.trim()) config[k] = encryptSecret(v.trim());
    } else {
      config[k] = String(v || '').trim();
    }
  }
  const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !!cur?.enabled;
  const row = await store.setIntegration(req.org.id, 'intacct', { enabled, config });
  audit(req, 'update', 'integrations', 'intacct', `Updated Sage Intacct integration (${enabled ? 'enabled' : 'disabled'})`);
  res.json({ enabled: !!row.enabled, config: intacctClientConfig(row) });
}));

app.post('/api/integrations/intacct/test', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  if (!secretsConfigured()) return res.status(503).json({ error: 'Secret storage is not configured on the server (set SECRETS_KEY).' });
  const row = await store.getIntegration(req.org.id, 'intacct');
  const cfg = resolveIntacctConfig(row);
  if (!cfg) return res.status(400).json({ error: 'Enter and save all required Intacct credentials first.' });
  try { res.json(await testIntacct(cfg)); }
  catch (e) { res.status(502).json({ error: e.message || 'Intacct connection failed' }); }
}));

// --- Generic org-scoped resource factory ---
// fields: allowlist of client-writable columns (org_id/id never included).
// ownerField: if set, stamped with the viewer's email on create.
// filters: query params that may narrow a list (e.g. ?project_id=...).
// beforeInsert: optional async (data, req) => void to derive server-side fields
//   (e.g. a sequential work-order number) before the row is written.
// A member is region-restricted when they're assigned to a region and are not a
// workspace admin (members:write). Managers and unassigned members see all.
const regionRestricted = (viewer) => !!viewer?.region_id && !viewer.capabilities?.includes('members:write');

function resource(path, collection, writeCap, { fields, ownerField, filters = [], beforeInsert, afterInsert, afterUpdate, selfScope, regionScope } = {}) {
  const pick = (body) => Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => fields.includes(k))
  );
  // Read-gate every GET by the page this collection belongs to (from the
  // permission catalog). Reads for a page the role can't view return 403.
  const page = COLLECTION_PAGE[collection];
  const readGate = page ? [requireAuth, requirePageView(page)] : [requireAuth];

  app.get(`/api/${path}`, ...readGate, wrap(async (req, res) => {
    const f = {};
    for (const key of filters) if (req.query[key]) f[key] = req.query[key];
    // Restricted roles (technician) only ever see their OWN records: force the
    // scoping filter to the viewer's email, ignoring any client-supplied value.
    if (selfScope && isRestrictedRole(req.viewer.role)) f[selfScope] = req.viewer.email.toLowerCase();
    // Region-restricted members see only their region's records (managers see all).
    if (regionScope && regionRestricted(req.viewer)) f[regionScope] = req.viewer.region_id;
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

  app.get(`/api/${path}/:id`, ...readGate, wrap(async (req, res) => {
    const row = await store.getById(collection, req.org.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Restricted role: only its own records are visible.
    if (selfScope && isRestrictedRole(req.viewer.role) && String(row[selfScope] || '').toLowerCase() !== req.viewer.email.toLowerCase()) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Region-restricted member: only records in their region.
    if (regionScope && regionRestricted(req.viewer) && row[regionScope] !== req.viewer.region_id) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(row);
  }));

  const labelOf = (r) => r?.number || r?.name || r?.title || r?.id;

  app.post(`/api/${path}`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const data = pick(req.body);
    if (ownerField) data[ownerField] = req.viewer.email;
    if (beforeInsert) await beforeInsert(data, req);
    const row = await store.insert(collection, req.org.id, data);
    audit(req, 'create', collection, row.id, `Created ${collection} ${labelOf(row)}`);
    if (afterInsert) Promise.resolve(afterInsert(row, req)).catch((e) => console.warn('[afterInsert] skipped:', e?.message || e));
    res.status(201).json(row);
  }));

  app.patch(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), wrap(async (req, res) => {
    const changes = pick(req.body);
    const row = await store.update(collection, req.org.id, req.params.id, changes);
    if (!row) return res.status(404).json({ error: 'Not found' });
    audit(req, 'update', collection, row.id, `Updated ${collection} ${labelOf(row)}`, { fields: Object.keys(changes) });
    if (afterUpdate) Promise.resolve(afterUpdate(row, changes, req)).catch((e) => console.warn('[afterUpdate] skipped:', e?.message || e));
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
  selfScope: 'assignee_email', // technicians see only their own scheduled jobs
});
resource('time-entries', 'time_entries', 'time:write', {
  fields: ['job_id', 'work_order_id', 'clock_in', 'clock_out', 'notes'],
  ownerField: 'user_email',
  filters: ['job_id', 'work_order_id', 'user_email'],
  selfScope: 'user_email', // technicians see only their own time
});
resource('items', 'items', 'items:write', {
  fields: ['name', 'sku', 'image_url', 'unit', 'unit_cost'],
});
resource('item-usage', 'item_usage', 'usage:write', {
  fields: ['item_id', 'project_id', 'job_id', 'quantity', 'unit_cost_at_use', 'used_at', 'notes'],
  ownerField: 'recorded_by',
  filters: ['item_id', 'project_id', 'job_id', 'recorded_by'],
  selfScope: 'recorded_by', // technicians see only usage they logged
});
resource('attachments', 'attachments', 'attachments:write', {
  fields: ['entity_type', 'entity_id', 'url', 'kind', 'caption'],
  ownerField: 'created_by',
  filters: ['entity_type', 'entity_id', 'kind'],
});

// --- Org structure: Regions + Teams (managers create/edit; any member reads) ---
resource('regions', 'regions', 'regions:write', {
  fields: ['name'],
  ownerField: 'created_by',
});
resource('teams', 'teams', 'teams:write', {
  fields: ['name', 'region_id'],
  ownerField: 'created_by',
  filters: ['region_id'],
});

// --- CRM spine: customers → sites → assets → work orders ---
resource('customers', 'customers', 'customers:write', {
  fields: ['name', 'billing_email', 'phone', 'billing_address', 'payment_terms', 'po_required', 'status', 'notes', 'region_id'],
  ownerField: 'created_by',
  filters: ['status', 'region_id'],
  regionScope: 'region_id', // region-restricted members see only their region's customers
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
// Resolve the customer-facing phone for a work order (site contact first).
async function woPhone(org, wo) {
  if (wo.site_id) { const s = await store.getById('sites', org, wo.site_id); if (s?.contact_phone) return s.contact_phone; }
  if (wo.customer_id) { const c = await store.getById('customers', org, wo.customer_id); if (c?.phone) return c.phone; }
  return null;
}
// Text the customer that a tech is on the way. Fire-and-forget; never blocks.
async function notifyOnTheWay(req, wo) {
  if (!smsEnabled()) return { sent: false };
  const phone = await woPhone(req.org.id, wo);
  const msg = `${req.org?.name || 'Service'}: a technician is on the way${wo.number ? ` for ${wo.number}` : ''}${wo.title ? ` — ${wo.title}` : ''}.`;
  const r = await sendSMS(phone, msg);
  if (r.sent) audit(req, 'notify', 'work_orders', wo.id, `Texted customer "on the way" for ${wo.number || wo.id}`);
  return r;
}

resource('work-orders', 'work_orders', 'work_orders:write', {
  fields: ['customer_id', 'site_id', 'asset_id', 'title', 'description', 'priority', 'status', 'assignee_email', 'requested_by', 'sla_due', 'scheduled_start', 'scheduled_end', 'completed_at', 'resolution_notes', 'signature_url', 'signature_name'],
  ownerField: 'created_by',
  filters: ['customer_id', 'site_id', 'asset_id', 'status', 'assignee_email'],
  selfScope: 'assignee_email', // technicians see only work orders assigned to them
  // When a work order flips to en route, text the customer automatically.
  // When it's (re)assigned to a tech, notify that tech in-app.
  afterUpdate: (row, changes, req) => {
    if (changes.assignee_email && row.assignee_email && row.assignee_email !== req.viewer.email) {
      notifyUser(req.org.id, row.assignee_email, 'wo_assignment', { title: `Assigned to you: ${row.number || 'work order'}`, body: row.title, link: `/work-orders/${row.id}` }).catch(() => {});
    }
    if (changes.status === 'en_route') return notifyOnTheWay(req, row);
  },
  // Notify the assignee when a work order is created already assigned.
  afterInsert: (row, req) => {
    if (row.assignee_email && row.assignee_email !== req.viewer.email) {
      return notifyUser(req.org.id, row.assignee_email, 'wo_assignment', { title: `Assigned to you: ${row.number || 'work order'}`, body: row.title, link: `/work-orders/${row.id}` });
    }
  },
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

// --- Customer ticketing (threaded conversation; staff side) ---
// Reads are gated by the 'tickets' page; replying needs tickets:write.
const ticketRead = [requireAuth, requirePageView('tickets')];

app.get('/api/tickets', ...ticketRead, wrap(async (req, res) => {
  const f = {};
  for (const k of ['customer_id', 'work_order_id', 'status', 'assignee_email']) if (req.query[k]) f[k] = req.query[k];
  const limit = clampLimit(req.query.limit) ?? DEFAULT_LIMIT;
  // Sort newest-conversation-first (last_message_at), not creation order.
  const rows = (await store.list('tickets', req.org.id, f, { limit: null }))
    .sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at)))
    .slice(0, limit);
  res.json(rows);
}));

app.get('/api/tickets/:id', ...ticketRead, wrap(async (req, res) => {
  const t = await store.getById('tickets', req.org.id, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
}));

app.get('/api/tickets/:id/messages', ...ticketRead, wrap(async (req, res) => {
  const msgs = await store.list('ticket_messages', req.org.id, { ticket_id: req.params.id }, { limit: null });
  res.json(msgs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
}));

// Staff opens a ticket (subject + first message). Optionally tied to a customer / work order.
app.post('/api/tickets', requireAuth, requireCapability('tickets:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const subject = String(req.body?.subject || '').trim().slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!subject) return res.status(400).json({ error: 'A subject is required' });
  let customer_id = null, work_order_id = null;
  if (req.body?.customer_id && await store.getById('customers', org, req.body.customer_id)) customer_id = req.body.customer_id;
  if (req.body?.work_order_id) {
    const w = await store.getById('work_orders', org, req.body.work_order_id);
    if (w) { work_order_id = w.id; if (!customer_id) customer_id = w.customer_id; }
  }
  const priority = ['low', 'medium', 'high', 'urgent'].includes(req.body?.priority) ? req.body.priority : 'medium';
  const ticket = await store.insert('tickets', org, {
    number: await nextTicketNumber(org), customer_id, work_order_id, subject,
    status: 'open', priority, assignee_email: req.viewer.email, last_message_at: now(), created_by: req.viewer.email,
  });
  if (body) {
    await store.insert('ticket_messages', org, { ticket_id: ticket.id, author_type: 'staff', author_email: req.viewer.email, author_name: req.viewer.name || req.viewer.email, body });
    await emailTicketReply(req, ticket, body).catch((e) => console.warn('[ticket email] skipped:', e?.message || e));
  }
  audit(req, 'create', 'tickets', ticket.id, `Opened ticket ${ticket.number} — ${subject}`);
  res.status(201).json(ticket);
}));

app.patch('/api/tickets/:id', requireAuth, requireCapability('tickets:write'), wrap(async (req, res) => {
  const patch = {};
  if (['open', 'pending', 'resolved', 'closed'].includes(req.body?.status)) patch.status = req.body.status;
  if (['low', 'medium', 'high', 'urgent'].includes(req.body?.priority)) patch.priority = req.body.priority;
  if (typeof req.body?.assignee_email === 'string') patch.assignee_email = req.body.assignee_email.trim() || null;
  if (typeof req.body?.subject === 'string' && req.body.subject.trim()) patch.subject = req.body.subject.trim().slice(0, 200);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const row = await store.update('tickets', req.org.id, req.params.id, patch);
  if (!row) return res.status(404).json({ error: 'Not found' });
  audit(req, 'update', 'tickets', row.id, `Updated ticket ${row.number}`, { fields: Object.keys(patch) });
  res.json(row);
}));

// Staff reply → append message, bump the thread, and email the customer.
app.post('/api/tickets/:id/messages', requireAuth, requireCapability('tickets:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const t = await store.getById('tickets', org, req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'A message is required' });
  const msg = await store.insert('ticket_messages', org, { ticket_id: t.id, author_type: 'staff', author_email: req.viewer.email, author_name: req.viewer.name || req.viewer.email, body });
  // Replying moves an open/pending ticket to 'pending' (awaiting the customer).
  await store.update('tickets', org, t.id, { last_message_at: now(), status: t.status === 'closed' ? 'closed' : 'pending' });
  const emailed = await emailTicketReply(req, t, body).catch((e) => { console.warn('[ticket email] skipped:', e?.message || e); return { sent: false }; });
  audit(req, 'reply', 'tickets', t.id, `Replied to ticket ${t.number}${emailed?.sent ? ' (emailed customer)' : ''}`);
  res.status(201).json({ message: msg, emailed: !!emailed?.sent });
}));

// Email a staff reply to the customer, from the workspace's configured sender.
// Best-effort: returns { sent:false } (never throws to the caller path) when the
// customer has no email on file or email isn't configured.
async function emailTicketReply(req, ticket, body) {
  if (!emailEnabled() || !ticket.customer_id) return { sent: false };
  const [org, customer] = await Promise.all([store.getOrg(req.org.id), store.getById('customers', req.org.id, ticket.customer_id)]);
  const to = customer?.billing_email;
  if (!to) return { sent: false };
  const brand = org?.name || 'Support';
  const portalUrl = customer?.portal_token ? `${appOrigin(req)}/portal/${customer.portal_token}` : null;
  const text = [
    `${body}`, '', '—', `${brand} · Re: ${ticket.subject} (${ticket.number || 'ticket'})`,
    portalUrl ? `View and reply: ${portalUrl}` : '',
  ].filter(Boolean).join('\n');
  return sendEmail(org, { to, subject: `Re: ${ticket.subject} [${ticket.number || 'ticket'}]`, text });
}

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

// Take a card in-app: create a Checkout session for an invoice's balance.
app.post('/api/invoices/:id/checkout', requireAuth, requireCapability('invoices:write'), wrap(async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Online payments are not enabled' });
  const inv = await store.getById('invoices', req.org.id, req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid || 0)) * 100);
  if (balance <= 0) return res.status(400).json({ error: 'Nothing due on this invoice' });
  const url = appOrigin(req);
  const session = await createCheckout({
    amountCents: balance, name: `Invoice ${inv.number}`,
    successUrl: `${url}/invoices/${inv.id}?paid=1`, cancelUrl: `${url}/invoices/${inv.id}`,
    metadata: { kind: 'invoice', org_id: req.org.id, invoice_id: inv.id },
  });
  res.json({ url: session.url });
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

// Manually text the customer that a tech is on the way.
app.post('/api/work-orders/:id/notify', requireAuth, requireCapability('work_orders:write'), wrap(async (req, res) => {
  if (!smsEnabled()) return res.status(503).json({ error: 'SMS is not configured' });
  const wo = await store.getById('work_orders', req.org.id, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  try { res.json(await notifyOnTheWay(req, wo)); }
  catch (e) { res.status(502).json({ error: e.message || 'Could not send text' }); }
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

// (Demo-data seeding moved to the super-admin console — POST
// /api/super/orgs/:id/demo-seed — since it's a platform-operator tool.)

// Full workspace data export (backup / anti-lock-in). Manager-only. Returns a
// single JSON document of every table for this org.
app.get('/api/export', requireAuth, requireCapability('members:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const tables = ['projects', 'punch_items', 'service_offers', 'jobs', 'time_entries', 'items', 'item_usage', 'attachments',
    'customers', 'sites', 'assets', 'work_orders', 'work_order_lines', 'invoices', 'invoice_lines', 'maintenance_plans',
    'tickets', 'ticket_messages'];
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
