import dotenv from 'dotenv';
// Clerk CLI writes keys to .env.local; load it first (wins), then .env fills gaps.
dotenv.config({ path: '.env.local' });
dotenv.config();
import * as Sentry from '@sentry/node';
// Sentry.init() runs in ./instrument.mjs, loaded before this module (via
// `node --import` locally and as api/index.js's first import on Vercel) so it
// can instrument Express. See instrument.mjs for why it can't live here.
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
import { seedDemoInto, flushDemoFrom } from './lib/demo.js';
import { runBackup } from './lib/backup.js';
import { generateDue } from './lib/maintenance.js';
import { paymentsEnabled, createCheckout, verifyWebhook, createBillingPortalSession } from './lib/payments.js';
import { smsEnabled, sendSMS } from './lib/notify.js';
import { emailEnabled, sendEmail } from './lib/email.js';
import { encryptSecret, secretsConfigured } from './lib/crypto.js';
import { INTACCT_FIELDS, resolveIntacctConfig, testIntacct, pushInvoiceToIntacct } from './lib/intacct.js';
import { uploadFile } from './lib/files.js';
import {
  attachClerk, assertProductionAuth, resolveViewer, resolveRolePerms, invalidateRoleCache,
  requireAuth, requireCapability, requirePageView, requireFeature, requirePlatformAdmin, isPlatformAdmin,
} from './lib/auth.js';
import { PAGES, PAGE_KEYS, PRESET_ROLES, ROLE_LABEL, CAP_LABEL, COLLECTION_PAGE, presetPerms, sanitizePerms, isRestrictedRole, featureActive } from './lib/permissions.js';
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

// Auth resolution runs BEFORE rate limiting so authenticated limiters can key
// by user rather than IP — several users on one office network share an IP,
// and per-IP limits either let a shared-IP office starve one abusive user's
// neighbors or (if raised to compensate) stop being an effective cap at all.
attachClerk(app);
app.use(resolveViewer);

// Rate limiting: authenticated endpoints key by viewer email (falls back to IP
// when unauthenticated); the public portal has no viewer, so it stays IP-keyed.
const byUserOrIp = (req) => req.viewer?.email ? `u:${req.viewer.email}` : `ip:${req.ip}`;
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, keyGenerator: byUserOrIp });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: byUserOrIp });
// AI calls hit a paid third-party API — cap them tightly per user.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: byUserOrIp });
// Public customer portal — unauthenticated, so cap it tightly per IP.
const portalLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/api/uploads', uploadLimiter);
app.use('/api/ai', aiLimiter);
app.use('/api/portal', portalLimiter);

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
  wo_creator_assigned: 'When a work order I created is assigned to someone',
  wo_completed: 'When a work order I created is completed',
  wo_approved: 'When a work order I created or am assigned to is approved',
  wo_overdue: 'When a work order I’m assigned to passes its SLA due date',
  portal_request: 'When a customer submits a new service request',
  ticket_opened: 'When a customer opens a new support ticket',
  ticket_message: 'When a customer sends a portal ticket message',
  invoice_paid: 'When one of my invoices is paid online',
  invoice_overdue: 'When one of my invoices becomes overdue',
  payment_failed: 'When a customer’s online payment doesn’t complete',
  maintenance_generated: 'When preventive maintenance creates new work orders',
  member_changed: 'When a teammate is added or their role changes',
  daily_digest: 'A daily summary of today’s jobs, overdue work, and unpaid invoices',
  // quote_decided — reserved for when Quotes & Estimates ship (roadmap P1).
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

// Fan a notification out to every member of a workspace (each still respects
// their own opt-out). Used for org-wide events like a new inbound service
// request. Fire-and-forget: never throws into the caller's request path.
async function notifyAllStaff(orgId, type, payload, { exclude } = {}) {
  const members = await store.listMembers(orgId).catch(() => []);
  await Promise.all(members
    .filter((m) => m.user_email !== exclude)
    .map((m) => notifyUser(orgId, m.user_email, type, payload)));
}

// Notify only members whose (preset or custom) role holds a given capability —
// e.g. tell everyone who can manage invoices that one just went overdue. Each
// member's caps are resolved through the same cached path the API uses.
async function notifyByCapability(orgId, cap, type, payload, { exclude } = {}) {
  const members = await store.listMembers(orgId).catch(() => []);
  await Promise.all(members.map(async (m) => {
    if (m.user_email === exclude) return;
    const perms = await resolveRolePerms(orgId, m.role).catch(() => null);
    if (perms?.caps?.has(cap)) return notifyUser(orgId, m.user_email, type, payload);
  }));
}

// Tell the maintenance managers that the scheduler just created work orders.
const notifyMaintenanceCreated = (orgId, count) =>
  notifyByCapability(orgId, 'maintenance:write', 'maintenance_generated', {
    title: `${count} maintenance work order${count > 1 ? 's' : ''} generated`,
    body: 'Preventive maintenance created new work orders that need scheduling.',
    link: '/work-orders',
  });

// --- Public customer portal (link-based, no login) ---
// The unguessable portal_token identifies the customer. Only that customer's
// own data is returned, and only safe fields (no internal costs/margins).
//
// Resolve the portal customer AND confirm the workspace still has the portal
// feature on. When it's off the portal must read as if it never existed, so we
// return the same 404 as an unknown token rather than leaking that it's gated.
async function portalCustomer(token) {
  const c = await store.customerByPortalToken(token);
  if (!c) return null;
  const org = await store.getOrg(c.org_id);
  if (!featureActive(org?.feature_flags, 'portal')) return null;
  return c;
}

app.get('/api/portal/:token', wrap(async (req, res) => {
  const c = await portalCustomer(req.params.token);
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
  const c = await portalCustomer(req.params.token);
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
  // A brand-new ticket → its own "opened" notice (replies use ticket_message).
  notifyAllStaff(org, 'ticket_opened', { title: `New ticket ${ticket.number}: ${subject}`, body: `${c.name}: ${String(body).slice(0, 140)}`, link: '/tickets' }).catch(() => {});
  res.status(201).json({ ok: true, id: ticket.id, number: ticket.number });
}));

app.post('/api/portal/:token/tickets/:id/messages', wrap(async (req, res) => {
  const c = await portalCustomer(req.params.token);
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
  const c = await portalCustomer(req.params.token);
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
  // Let the whole team know a new job came in from a customer.
  notifyAllStaff(org, 'portal_request', { title: `New service request: ${wo.number}`, body: `${c.name}: ${title}`, link: `/work-orders/${wo.id}` }).catch(() => {});
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
        if (inv.created_by && inv.created_by !== 'portal') {
          notifyUser(m.org_id, inv.created_by, 'invoice_paid', { title: `Invoice ${inv.number} was paid`, body: `$${inv.total} received online`, link: `/invoices/${inv.id}` }).catch(() => {});
        }
      }
    }
  }
  // A checkout the customer started but never completed (session expired or the
  // payment failed) → let the invoice's owner know it didn't go through.
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const m = event.data?.object?.metadata || {};
    if (m.kind === 'invoice' && m.org_id && m.invoice_id) {
      const inv = await store.getById('invoices', m.org_id, m.invoice_id);
      if (inv && inv.status !== 'paid' && inv.created_by && inv.created_by !== 'portal') {
        notifyUser(m.org_id, inv.created_by, 'payment_failed', { title: `Payment didn’t complete for ${inv.number}`, body: `${inv.customer_id ? 'The customer' : 'A customer'} started but didn’t finish paying online.`, link: `/invoices/${inv.id}` }).catch(() => {});
      }
    }
  }
  res.json({ received: true });
}));

const appOrigin = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

// Customer pays an invoice from the portal (link-scoped, no login).
app.post('/api/portal/:token/pay', wrap(async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Online payments are not enabled' });
  const c = await portalCustomer(req.params.token);
  if (!c) return res.status(404).json({ error: 'Portal not found' });
  // Respect the workspace's own payments toggle, not just the global config.
  const payOrg = await store.getOrg(c.org_id);
  if (!featureActive(payOrg?.feature_flags, 'payments')) return res.status(503).json({ error: 'Online payments are not enabled' });
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

// Dynamic PWA manifest — returns workspace branding so the installed PWA gets the
// right name, color, and icon. Called by the inline <link rel="manifest"> script.
app.get('/api/manifest.webmanifest', wrap(async (req, res) => {
  const slug = req.query.org;
  let name = 'Nexus Field';
  let themeColor = '#127c6e';
  let iconSrc = '/icon.svg';
  let startUrl = '/';
  if (slug) {
    try {
      const org = await store.getOrg(slug);
      if (org) {
        name = org.branding?.displayName || org.name || name;
        if (org.branding?.primaryColor) themeColor = org.branding.primaryColor;
        if (org.branding?.logoUrl) iconSrc = org.branding.logoUrl;
        startUrl = `/${org.id}/`;
      }
    } catch { /* fall through to defaults */ }
  }
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: 'Field service management',
    theme_color: themeColor,
    background_color: '#0f172a',
    display: 'standalone',
    orientation: 'portrait',
    start_url: startUrl,
    icons: [
      { src: iconSrc, sizes: 'any', type: iconSrc.endsWith('.svg') ? 'image/svg+xml' : 'image/png', purpose: 'any maskable' },
    ],
  });
}));

// --- Identity: who am I, what workspace, what can I do ---
// Platform favicon — the browser-tab icon for every non-workspace surface
// (super-admin, sign-in, the app origin). Redirects to the URL a Super Admin set
// in Platform settings, or the built-in Nexus Field mark. Public; referenced by
// <link rel="icon" href="/api/favicon"> in index.html.
app.get('/api/favicon', wrap(async (req, res) => {
  const branding = await store.getPlatformSetting('branding').catch(() => null);
  const url = branding?.faviconUrl;
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.redirect(302, (typeof url === 'string' && /^https?:\/\//i.test(url)) ? url : '/icon.svg');
}));

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
    // A capability is available only when it's both configured on the server AND
    // active for this workspace, so the client hides its UI when either is off.
    features: {
      ai: aiConfigured() && (!req.org || featureActive(req.org.feature_flags, 'ai')),
      payments: paymentsEnabled() && (!req.org || featureActive(req.org.feature_flags, 'payments')),
      sms: smsEnabled() && (!req.org || featureActive(req.org.feature_flags, 'sms')),
    },
  });
}));

app.get('/api/members', requireAuth, requirePageView('team'), wrap(async (req, res) => {
  res.json(await store.listMembers(req.org.id));
}));

// Presence: polled "who's online" — a heartbeat + windowed lookup, not a held-
// open WebSocket. Supabase Realtime caps at 200 connections/channel (500 total
// on Pro), which large workspaces exceed; polling has no such ceiling.
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;
app.post('/api/presence/heartbeat', requireAuth, wrap(async (req, res) => {
  await store.heartbeat(req.org.id, req.viewer.email);
  res.json({ ok: true });
}));
app.get('/api/presence', requireAuth, wrap(async (req, res) => {
  const since = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
  const rows = await store.listOnline(req.org.id, since);
  res.json(rows.map((r) => ({ email: r.user_email, name: r.name, online_at: r.last_seen_at })));
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
  // Presets report their EFFECTIVE (resolved) permissions — code default with
  // any platform/workspace override applied — plus their hidden state.
  const presets = await Promise.all(PRESET_ROLES.map(async (k) => {
    const o = byKey[k];
    const eff = await resolveRolePerms(orgId, k);
    return { key: k, name: o?.name || ROLE_LABEL[k] || k, permissions: { pages: [...eff.pages], caps: [...eff.caps] }, preset: true, hidden: !!o?.hidden, default_region_id: o?.default_region_id || null };
  }));
  const customs = stored.filter((r) => !PRESET_ROLES.includes(r.key)).map(roleView);
  return [...presets, ...customs];
}
// A role key is assignable if it's a non-hidden preset or an existing custom role.
const assignableRole = async (orgId, key) => {
  if (!key) return false;
  if (PRESET_ROLES.includes(key)) return !(await store.getRole(orgId, key).catch(() => null))?.hidden;
  return !!(await store.getRole(orgId, key));
};
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

  // Built-in roles: an Org Admin may override the display name, default region,
  // the VISIBLE PAGES, and whether the role is hidden. Capabilities stay
  // platform-defined (Super Admin → Role defaults), never per-workspace here.
  if (PRESET_ROLES.includes(key)) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (default_region_id !== undefined) patch.default_region_id = default_region_id;
    if (Array.isArray(req.body?.permissions?.pages)) {
      patch.permissions = { pages: [...new Set(['dashboard', ...req.body.permissions.pages.filter((k) => PAGE_KEYS.includes(k))])] };
    }
    if (typeof req.body?.hidden === 'boolean') patch.hidden = req.body.hidden;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    const row = await store.setRoleMeta(req.org.id, key, patch);
    invalidateRoleCache(req.org.id, key);
    audit(req, 'update', 'roles', key, `Updated built-in role ${row.name || key}`);
    const eff = await resolveRolePerms(req.org.id, key);
    return res.json({ key, name: row.name || ROLE_LABEL[key] || key, permissions: { pages: [...eff.pages], caps: [...eff.caps] }, preset: true, hidden: !!row.hidden, default_region_id: row.default_region_id || null });
  }

  const patch = {};
  if (name !== undefined) patch.name = name;
  if (req.body?.permissions && typeof req.body.permissions === 'object') patch.permissions = sanitizePerms(req.body.permissions);
  if (default_region_id !== undefined) patch.default_region_id = default_region_id;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const row = await store.updateRole(req.org.id, key, patch);
  if (!row) return res.status(404).json({ error: 'Role not found' });
  invalidateRoleCache(req.org.id, key);
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
  // Work-order settings (org admin): the prompt shown above the customer
  // signature pad, e.g. "By signing, you confirm the work above is complete."
  if (req.body?.workOrders && typeof req.body.workOrders === 'object') {
    const org = await store.getOrg(req.org.id);
    const ff = patch.feature_flags || { ...(org?.feature_flags || {}) };
    const wo = req.body.workOrders;
    ff.workOrders = { ...(ff.workOrders || {}), ...(typeof wo.signaturePrompt === 'string' ? { signaturePrompt: wo.signaturePrompt.slice(0, 300) } : {}) };
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
//
// Each load does 7 unbounded table scans (no status filter pushed to the DB —
// OPEN_WO etc. are computed in JS). With many users hitting the dashboard on
// login, that multiplies fast, so the result is cached per-org for a short
// window: dashboard stats tolerate a few seconds of staleness fine.
const DASHBOARD_CACHE_MS = 20_000;
const dashboardCache = new Map(); // orgId -> { data, exp }
async function computeDashboard(org) {
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
  return {
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
  };
}
app.get('/api/dashboard', requireAuth, wrap(async (req, res) => {
  const org = req.org.id;
  const hit = dashboardCache.get(org);
  if (hit && hit.exp > Date.now()) return res.json(hit.data);
  const data = await computeDashboard(org);
  dashboardCache.set(org, { data, exp: Date.now() + DASHBOARD_CACHE_MS });
  res.json(data);
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
  const role = req.body?.role && await assignableRole(org.id, req.body.role) ? req.body.role : 'manager_admin';
  res.cookie('view_as', JSON.stringify({ org: org.id, role }), { httpOnly: true, sameSite: 'lax', secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production', maxAge: VIEW_AS_MAX_AGE, path: '/' });
  res.json({ ok: true, org: { id: org.id, name: org.name }, role });
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

// Flush all demo/business data from a workspace (keeps org, real members,
// roles, and integration credentials). Powers the "Eliminate demo data" button.
app.post('/api/super/orgs/:id/demo-flush', superOnly, wrap(async (req, res) => {
  const org = await store.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Workspace not found' });
  const result = await flushDemoFrom(org.id);
  audit(req, 'delete', 'orgs', org.id, `Eliminated demo data from ${org.name}`);
  res.json(result);
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

// --- Platform-wide settings (Super Admin → Platform): favicon, etc. ---
app.get('/api/super/settings', superOnly, wrap(async (_req, res) => {
  res.json({ branding: (await store.getPlatformSetting('branding')) || {} });
}));
app.patch('/api/super/settings', superOnly, wrap(async (req, res) => {
  const cur = (await store.getPlatformSetting('branding')) || {};
  const next = { ...cur };
  if (Object.prototype.hasOwnProperty.call(req.body?.branding || {}, 'faviconUrl')) {
    const v = String(req.body.branding.faviconUrl || '').trim();
    next.faviconUrl = /^https?:\/\//i.test(v) ? v : null; // only real URLs, else clear
  }
  await store.setPlatformSetting('branding', next);
  res.json({ branding: next });
}));

// --- Platform-wide built-in role defaults (Super Admin → Role defaults) ---
// The permission catalog (pages + their capabilities) the editor renders from.
const roleCatalog = () => ({
  pages: PAGES.filter((p) => p.key !== 'dashboard').map((p) => ({ key: p.key, label: p.label, caps: (p.caps || []).map((c) => ({ key: c, label: CAP_LABEL[c] || c })) })),
});
app.get('/api/super/role-defaults', superOnly, wrap(async (_req, res) => {
  const roles = await Promise.all(PRESET_ROLES.map(async (k) => {
    const code = presetPerms(k);
    const override = await store.getRoleDefault(k);
    return { key: k, label: ROLE_LABEL[k] || k, restricted: isRestrictedRole(k), code, effective: sanitizePerms(override || code) };
  }));
  res.json({ ...roleCatalog(), roles });
}));
// Set (or clear) a preset's platform-wide default. `applyToWorkspaces:true` also
// drops any per-workspace PAGE customization for that role so every workspace
// snaps to the new default; false leaves customized workspaces alone.
app.patch('/api/super/role-defaults/:key', superOnly, wrap(async (req, res) => {
  const key = req.params.key;
  if (!PRESET_ROLES.includes(key)) return res.status(400).json({ error: 'Not a built-in role' });
  const perms = sanitizePerms(req.body?.permissions || {});
  await store.setRoleDefault(key, perms);
  if (req.body?.applyToWorkspaces === true) await store.clearPresetPageOverrides(key);
  invalidateRoleCache(); // platform-wide change → clear every workspace's cache
  res.json({ key, effective: perms, appliedToWorkspaces: req.body?.applyToWorkspaces === true });
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
  // A manager can build a team but can't hand out the owner role above them.
  if (role === 'org_admin' && !req.viewer.capabilities?.includes('roles:write')) return res.status(403).json({ error: 'Only an Org Admin can grant the Org Admin role' });
  // Region: explicit choice wins; otherwise inherit the role's default region.
  let region_id = req.body?.region_id || null;
  if (!region_id) region_id = (await roleDefaultRegion(req.org.id, role)) || null;
  const member = await store.addMember(req.org.id, { user_email, name, role, region_id, team_id: team_id || null });
  audit(req, 'member', 'org_members', user_email, `Invited ${user_email} as ${role}`);
  notifyByCapability(req.org.id, 'members:write', 'member_changed', { title: 'New teammate added', body: `${name || user_email} joined as ${ROLE_LABEL[role] || role}`, link: '/team' }, { exclude: req.viewer.email }).catch(() => {});

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
  if (role === 'org_admin' && !req.viewer.capabilities?.includes('roles:write')) return res.status(403).json({ error: 'Only an Org Admin can grant the Org Admin role' });
  const patch = { role, name };
  if ('region_id' in (req.body || {})) patch.region_id = req.body.region_id || null;
  if ('team_id' in (req.body || {})) patch.team_id = req.body.team_id || null;
  const row = await store.updateMember(req.org.id, req.params.email, patch);
  if (!row) return res.status(404).json({ error: 'Member not found' });
  audit(req, 'member', 'org_members', req.params.email, `Updated ${req.params.email}${role ? ` → ${role}` : ''}`);
  // On a role change, tell the affected teammate and the other admins.
  if (role && req.params.email !== req.viewer.email) {
    notifyUser(req.org.id, req.params.email, 'member_changed', { title: 'Your role was updated', body: `You’re now ${ROLE_LABEL[role] || role}`, link: '/' }).catch(() => {});
  }
  if (role) {
    notifyByCapability(req.org.id, 'members:write', 'member_changed', { title: 'Teammate role changed', body: `${row.name || req.params.email} is now ${ROLE_LABEL[role] || role}`, link: '/team' }, { exclude: req.viewer.email }).catch(() => {});
  }
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

app.get('/api/integrations/intacct', requireAuth, requireCapability('integrations:write'), wrap(async (req, res) => {
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

app.patch('/api/integrations/intacct', requireAuth, requireCapability('integrations:write'), wrap(async (req, res) => {
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

app.post('/api/integrations/intacct/test', requireAuth, requireCapability('integrations:write'), wrap(async (req, res) => {
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

// Emails of the viewer's teammates (same team_id), including the viewer. No
// team → just the viewer. Used by teamScope below.
async function teammateEmails(orgId, viewer) {
  const email = viewer.email.toLowerCase();
  if (!viewer.team_id) return new Set([email]);
  const members = await store.listMembers(orgId).catch(() => []);
  return new Set([email, ...members.filter((m) => m.team_id === viewer.team_id).map((m) => String(m.user_email).toLowerCase())]);
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const onDate = (r, day) => !!r.scheduled_start && String(r.scheduled_start).slice(0, 10) === day;
// teamScope visibility for a restricted role: always their OWN rows (any date/
// site), plus a teammate's row ONLY when it's scheduled for TODAY at a SITE the
// viewer is themselves working today — i.e. "who else is at my job site today,"
// not the whole team's calendar.
function teamScopeFilter(rows, field, siteField, viewerEmail, teamEmails) {
  const today = todayStr();
  const mySitesToday = new Set(
    rows.filter((r) => String(r[field] || '').toLowerCase() === viewerEmail && onDate(r, today) && r[siteField])
      .map((r) => r[siteField]),
  );
  return rows.filter((r) => {
    const owner = String(r[field] || '').toLowerCase();
    if (owner === viewerEmail) return true;
    if (!teamEmails.has(owner) || !onDate(r, today)) return false;
    return r[siteField] && mySitesToday.has(r[siteField]);
  });
}

function resource(path, collection, writeCap, { fields, ownerField, filters = [], beforeInsert, afterInsert, afterUpdate, selfScope, teamScope, teamScopeSite = 'site_id', regionScope, createCap } = {}) {
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
    const restricted = isRestrictedRole(req.viewer.role);
    // teamScope can't be expressed as a single equality filter (it's an OR
    // across teammates + a date condition), so fetch this collection's full org
    // scope (still bounded by regionScope below) and filter/paginate in memory.
    const usingTeamScope = teamScope && restricted;
    if (!usingTeamScope && selfScope && restricted) {
      // Restricted roles (technician) only ever see their OWN records: force the
      // scoping filter to the viewer's email, ignoring any client-supplied value.
      f[selfScope] = req.viewer.email.toLowerCase();
    }
    // Region-restricted members see only their region's records (managers see all).
    if (regionScope && regionRestricted(req.viewer)) f[regionScope] = req.viewer.region_id;
    // Bounded, keyset-paginated. Default limit keeps every list query capped;
    // pass ?limit= (<=MAX) and ?before=<cursor> to page. The response stays a
    // plain array (no client change); the next cursor is an opt-in header.
    const limit = clampLimit(req.query.limit) ?? DEFAULT_LIMIT;
    const before = req.query.before || null;
    let rows;
    if (usingTeamScope) {
      const teamEmails = await teammateEmails(req.org.id, req.viewer);
      const all = await store.list(collection, req.org.id, f, { limit: null, before: null });
      rows = teamScopeFilter(all, teamScope, teamScopeSite, req.viewer.email.toLowerCase(), teamEmails).slice(0, limit);
    } else {
      rows = await store.list(collection, req.org.id, f, { limit, before });
    }
    if (rows.length === limit) {
      const cursor = rows[rows.length - 1]?.[orderCol(collection)];
      if (cursor) res.setHeader('X-Next-Cursor', String(cursor));
    }
    res.json(rows);
  }));

  app.get(`/api/${path}/:id`, ...readGate, wrap(async (req, res) => {
    const row = await store.getById(collection, req.org.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Restricted role: only its own records, or (for teamScope) a teammate's
    // record scheduled for today, are visible.
    if (teamScope && isRestrictedRole(req.viewer.role)) {
      const teamEmails = await teammateEmails(req.org.id, req.viewer);
      // getById can't tell "my other sites today" from a single row, so pull the
      // viewer's own rows first to establish which sites they're at today.
      const mine = await store.list(collection, req.org.id, { [teamScope]: req.viewer.email.toLowerCase() }, { limit: null });
      const visible = teamScopeFilter([...mine, row], teamScope, teamScopeSite, req.viewer.email.toLowerCase(), teamEmails);
      if (!visible.some((r) => r.id === row.id)) {
        return res.status(404).json({ error: 'Not found' });
      }
    } else if (selfScope && isRestrictedRole(req.viewer.role) && String(row[selfScope] || '').toLowerCase() !== req.viewer.email.toLowerCase()) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Region-restricted member: only records in their region.
    if (regionScope && regionRestricted(req.viewer) && row[regionScope] !== req.viewer.region_id) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(row);
  }));

  const labelOf = (r) => r?.number || r?.name || r?.title || r?.id;

  app.post(`/api/${path}`, requireAuth, requireCapability(createCap || writeCap), wrap(async (req, res) => {
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
  // A field tech can quick-add a new catalog item (they need it and it isn't
  // in the list yet) without also getting edit/delete rights over the catalog.
  createCap: 'items:create',
});
resource('item-usage', 'item_usage', 'usage:write', {
  fields: ['item_id', 'project_id', 'job_id', 'work_order_id', 'quantity', 'unit_cost_at_use', 'used_at', 'notes'],
  ownerField: 'recorded_by',
  filters: ['item_id', 'project_id', 'job_id', 'work_order_id', 'recorded_by'],
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
app.post('/api/customers/:id/portal-token', requireAuth, requireFeature('portal'), requireCapability('customers:write'), wrap(async (req, res) => {
  const row = await store.update('customers', req.org.id, req.params.id, { portal_token: randomUUID() });
  if (!row) return res.status(404).json({ error: 'Not found' });
  audit(req, 'update', 'customers', row.id, `Rotated portal link for ${row.name}`);
  res.json({ portal_token: row.portal_token });
}));
resource('sites', 'sites', 'sites:write', {
  // lat/lon are optional stored coordinates so the Map page can place a pin
  // without a runtime geocode lookup (set at creation, or geocoded once and
  // saved back — see MapView.jsx).
  fields: ['customer_id', 'name', 'address', 'access_notes', 'notes', 'contact_name', 'contact_phone', 'status', 'lat', 'lon'],
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
// Should the work order's creator get a notification about `row`? Only when it
// has a real creator (not a portal submission) and that creator isn't the person
// who just made this change (no self-notifications).
const notifiableCreator = (row, actorEmail) =>
  !!row.created_by && row.created_by !== 'portal' && row.created_by !== actorEmail;

// Text the customer that a tech is on the way. Fire-and-forget; never blocks.
async function notifyOnTheWay(req, wo) {
  if (!smsEnabled()) return { sent: false };
  const phone = await woPhone(req.org.id, wo);
  const msg = `${req.org?.name || 'Service'}: a technician is on the way${wo.number ? ` for ${wo.number}` : ''}${wo.title ? ` — ${wo.title}` : ''}.`;
  const r = await sendSMS(phone, msg);
  if (r.sent) audit(req, 'notify', 'work_orders', wo.id, `Texted customer "on the way" for ${wo.number || wo.id}`);
  return r;
}

// Shared side effects for a work-order update (notifications, on-the-way SMS)
// — used by both the full resource() PATCH and the tech-safe endpoint below,
// so a technician's status change triggers the same notifications a
// manager's would.
const woAfterUpdate = (row, changes, req) => {
  if (changes.assignee_email && row.assignee_email && row.assignee_email !== req.viewer.email) {
    notifyUser(req.org.id, row.assignee_email, 'wo_assignment', { title: `Assigned to you: ${row.number || 'work order'}`, body: row.title, link: `/work-orders/${row.id}` }).catch(() => {});
  }
  // Tell whoever created the work order that it's been assigned — and to whom.
  // Skipped when the creator is the one assigning, is the assignee, or the WO
  // came in from the portal (no real creator to notify).
  if (changes.assignee_email && row.assignee_email && notifiableCreator(row, req.viewer.email) && row.created_by !== row.assignee_email) {
    notifyUser(req.org.id, row.created_by, 'wo_creator_assigned', { title: `${row.number || 'Your work order'} was assigned`, body: `Assigned to ${row.assignee_email}`, link: `/work-orders/${row.id}` }).catch(() => {});
  }
  // Tell the creator when their work order is completed.
  if (changes.status === 'completed' && notifiableCreator(row, req.viewer.email)) {
    notifyUser(req.org.id, row.created_by, 'wo_completed', { title: `${row.number || 'Your work order'} was completed`, body: row.title, link: `/work-orders/${row.id}` }).catch(() => {});
  }
  if (changes.status === 'en_route' && featureActive(req.org.feature_flags, 'sms')) return notifyOnTheWay(req, row);
};
resource('work-orders', 'work_orders', 'work_orders:write', {
  fields: ['customer_id', 'site_id', 'asset_id', 'title', 'description', 'priority', 'status', 'assignee_email', 'requested_by', 'sla_due', 'scheduled_start', 'scheduled_end', 'completed_at', 'resolution_notes', 'signature_url', 'signature_name', 'region_id'],
  ownerField: 'created_by',
  filters: ['customer_id', 'site_id', 'asset_id', 'status', 'assignee_email', 'region_id'],
  // Technicians see their own work orders always, plus a teammate's work order
  // only when it's scheduled for today AND at a site the technician is
  // themselves working today (site_id) — "who else is on my job site today."
  teamScope: 'assignee_email',
  regionScope: 'region_id',    // region-restricted members see only their region's work orders
  // When a work order flips to en route, text the customer automatically.
  // When it's (re)assigned to a tech, notify that tech in-app.
  afterUpdate: woAfterUpdate,
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
    // Inherit the customer's region so region-restricted members are scoped.
    if (!data.region_id && data.customer_id) {
      const c = await store.getById('customers', req.org.id, data.customer_id);
      if (c?.region_id) data.region_id = c.region_id;
    }
  },
});
resource('work-order-lines', 'work_order_lines', 'wo_lines:write', {
  fields: ['work_order_id', 'kind', 'description', 'quantity', 'unit_cost', 'unit_price', 'item_id'],
  filters: ['work_order_id', 'kind'],
});

// Field-tech "Add item": logs a part used, with no cost/price entry — that's
// billing, a manager's job. Cost is copied from the catalog item server-side
// (for accounting) and price defaults to 0 until a manager sets it on the
// full line-edit view. Also logs item_usage against this work order (not a
// project — most field techs never work with projects).
app.post('/api/work-orders/:id/add-item', requireAuth, requireCapability('wo_lines:add_item'), wrap(async (req, res) => {
  const wo = await store.getById('work_orders', req.org.id, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const item = await store.getById('items', req.org.id, req.body?.item_id);
  if (!item) return res.status(400).json({ error: 'Item not found' });
  const quantity = Number(req.body?.quantity) || 1;
  const line = await store.insert('work_order_lines', req.org.id, {
    work_order_id: wo.id, kind: 'part', item_id: item.id, description: item.name,
    quantity, unit_cost: Number(item.unit_cost) || 0, unit_price: 0,
  });
  const usage = await store.insert('item_usage', req.org.id, {
    item_id: item.id, work_order_id: wo.id, quantity, unit_cost_at_use: Number(item.unit_cost) || 0, recorded_by: req.viewer.email,
  });
  audit(req, 'create', 'work_order_lines', line.id, `Added item ${item.name} to ${wo.number || wo.id}`, { quantity });
  res.status(201).json({ line, usage });
}));

// Field-tech work-order update: a narrow slice of the full PATCH above — just
// status (a fixed set, matching the quick-action buttons in JobActions.jsx),
// resolution notes, and customer sign-off. No priority/assignee/schedule edits.
// A plain technician may only touch a work order assigned to them; anyone who
// already has full work_orders:write (manager/dispatcher/admin) can use this
// endpoint too — e.g. the same JobActions buttons on the Dispatch/Map pages.
const TECH_STATUSES = new Set(['en_route', 'on_site', 'scheduled', 'completed']);
const TECH_UPDATE_FIELDS = ['status', 'completed_at', 'resolution_notes', 'signature_name', 'signature_url'];
app.patch('/api/work-orders/:id/tech-update', requireAuth, requireCapability('work_orders:tech_update'), wrap(async (req, res) => {
  const row = await store.getById('work_orders', req.org.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const fullWrite = req.viewer.capabilities?.includes('work_orders:write');
  if (!fullWrite && String(row.assignee_email || '').toLowerCase() !== req.viewer.email.toLowerCase()) {
    return res.status(403).json({ error: 'Only the assigned technician can update this work order' });
  }
  const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => TECH_UPDATE_FIELDS.includes(k)));
  if (changes.status !== undefined && !TECH_STATUSES.has(changes.status)) {
    return res.status(400).json({ error: `status must be one of: ${[...TECH_STATUSES].join(', ')}` });
  }
  if (changes.status === 'completed' && !row.completed_at && !changes.completed_at) changes.completed_at = new Date().toISOString();
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
  const updated = await store.update('work_orders', req.org.id, row.id, changes);
  audit(req, 'update', 'work_orders', updated.id, `Updated ${updated.number || updated.id}`, { fields: Object.keys(changes) });
  Promise.resolve(woAfterUpdate(updated, changes, req)).catch((e) => console.warn('[woAfterUpdate] skipped:', e?.message || e));
  res.json(updated);
}));

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
  if (result.created) {
    audit(req, 'create', 'work_orders', null, `Generated ${result.created} maintenance work order(s)`);
    notifyMaintenanceCreated(req.org.id, result.created).catch(() => {});
  }
  res.json(result);
}));
// Daily cron: generate due maintenance across every org (authorized by CRON_SECRET).
app.get('/api/cron/maintenance', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const client = db();
  if (!client) return res.json({ ok: false, skipped: 'supabase-not-configured' });
  const { data: orgs } = await client.from('orgs').select('id, feature_flags');
  let created = 0;
  for (const o of orgs || []) {
    if (!featureActive(o.feature_flags, 'maintenance')) continue; // skip workspaces with it turned off
    const r = await generateDue(o.id, 'cron');
    created += r.created;
    if (r.created) notifyMaintenanceCreated(o.id, r.created).catch(() => {});
  }
  res.json({ ok: true, created });
}));

// Compose a one-line manager digest for a workspace, or null when there's
// nothing worth pinging about (so we never send an empty "0 things" summary).
async function buildDigest(orgId, flags, todayStr, now, openStatuses) {
  const parts = [];
  if (featureActive(flags, 'work_orders')) {
    const wos = await store.list('work_orders', orgId);
    const open = wos.filter((w) => openStatuses.includes(w.status));
    const overdue = open.filter((w) => w.sla_due && new Date(w.sla_due) < now).length;
    const todayJobs = wos.filter((w) => String(w.scheduled_start || '').slice(0, 10) === todayStr).length;
    if (open.length) parts.push(`${open.length} open work order${open.length > 1 ? 's' : ''}${overdue ? ` (${overdue} overdue)` : ''}`);
    if (todayJobs) parts.push(`${todayJobs} scheduled today`);
  }
  if (featureActive(flags, 'invoicing')) {
    const invs = await store.list('invoices', orgId);
    const unpaid = invs.filter((i) => i.status === 'sent' && Number(i.amount_paid || 0) < Number(i.total || 0));
    const outstanding = unpaid.reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid || 0)), 0);
    if (unpaid.length) parts.push(`${unpaid.length} unpaid invoice${unpaid.length > 1 ? 's' : ''} ($${Math.round(outstanding)} outstanding)`);
  }
  return parts.length ? { title: 'Your daily summary', body: parts.join(' · '), link: '/' } : null;
}

// Daily notifications cron (authorized by CRON_SECRET): flag work orders that
// blew their SLA and invoices that went overdue — once each, tracked by the
// *_alerted_at stamps — then send managers a one-line digest. Each recipient
// still honors their own notification preferences.
app.get('/api/cron/daily', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const OPEN_WO = ['requested', 'scheduled', 'en_route', 'on_site'];
  const orgs = await store.listOrgs().catch(() => []);
  const summary = { slaAlerts: 0, invoiceAlerts: 0, digests: 0 };
  for (const org of orgs) {
   try {
    const flags = org.feature_flags;
    if (featureActive(flags, 'work_orders')) {
      for (const wo of await store.list('work_orders', org.id)) {
        if (!OPEN_WO.includes(wo.status) || !wo.sla_due || new Date(wo.sla_due) >= now || wo.sla_alerted_at) continue;
        await store.update('work_orders', org.id, wo.id, { sla_alerted_at: now.toISOString() });
        summary.slaAlerts += 1;
        const payload = { title: `Overdue: ${wo.number || 'work order'}`, body: `${wo.title || 'A work order'} passed its SLA due date`, link: `/work-orders/${wo.id}` };
        if (wo.assignee_email) notifyUser(org.id, wo.assignee_email, 'wo_overdue', payload).catch(() => {});
        notifyByCapability(org.id, 'work_orders:approve', 'wo_overdue', payload, { exclude: wo.assignee_email }).catch(() => {});
      }
    }
    if (featureActive(flags, 'invoicing')) {
      for (const inv of await store.list('invoices', org.id)) {
        if (inv.status !== 'sent' || !inv.due_date || inv.due_date >= todayStr || inv.overdue_alerted_at) continue;
        if (Number(inv.amount_paid || 0) >= Number(inv.total || 0)) continue;
        await store.update('invoices', org.id, inv.id, { overdue_alerted_at: now.toISOString() });
        summary.invoiceAlerts += 1;
        const outstanding = (Number(inv.total) - Number(inv.amount_paid || 0)).toFixed(2);
        const payload = { title: `Invoice ${inv.number} is overdue`, body: `Was due ${inv.due_date} · $${outstanding} outstanding`, link: `/invoices/${inv.id}` };
        if (inv.created_by && inv.created_by !== 'portal') notifyUser(org.id, inv.created_by, 'invoice_overdue', payload).catch(() => {});
        notifyByCapability(org.id, 'invoices:write', 'invoice_overdue', payload, { exclude: inv.created_by }).catch(() => {});
      }
    }
    const digest = await buildDigest(org.id, flags, todayStr, now, OPEN_WO);
    if (digest) { notifyByCapability(org.id, 'reports:read', 'daily_digest', digest).catch(() => {}); summary.digests += 1; }
   } catch (e) {
    // One workspace failing (e.g. the dedup columns aren't migrated on this
    // deploy yet) must not abort the sweep for everyone else.
    console.warn(`[cron/daily] skipped ${org.id}:`, e?.message || e);
   }
  }
  res.json({ ok: true, ...summary });
}));

// Push an invoice into the workspace's Sage Intacct account (accounting sync).
// Requires the integration to be enabled + configured for this workspace.
app.post('/api/invoices/:id/intacct', requireAuth, requireCapability('invoices:write'), wrap(async (req, res) => {
  const org = req.org.id;
  const inv = await store.getById('invoices', org, req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const orgRow = await store.getOrg(org);
  if (!integrationAllowed(orgRow, 'intacct')) return res.status(403).json({ error: 'Sage Intacct is not enabled for this workspace.' });
  const integ = await store.getIntegration(org, 'intacct');
  if (!integ?.enabled) return res.status(400).json({ error: 'Turn on Sage Intacct in Settings → Integrations first.' });
  if (!secretsConfigured()) return res.status(503).json({ error: 'Secret storage is not configured on the server (SECRETS_KEY).' });
  const cfg = resolveIntacctConfig(integ);
  if (!cfg) return res.status(400).json({ error: 'Intacct credentials are incomplete — finish setup in Settings.' });
  const [lines, customer] = await Promise.all([
    store.list('invoice_lines', org, { invoice_id: inv.id }),
    inv.customer_id ? store.getById('customers', org, inv.customer_id) : Promise.resolve(null),
  ]);
  try {
    await pushInvoiceToIntacct(cfg, { invoice: inv, lines, customerRef: customer?.name || '' });
    audit(req, 'export', 'invoices', inv.id, `Sent invoice ${inv.number} to Sage Intacct`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Intacct push failed' });
  }
}));

// Take a card in-app: create a Checkout session for an invoice's balance.
app.post('/api/invoices/:id/checkout', requireAuth, requireFeature('payments'), requireCapability('invoices:write'), wrap(async (req, res) => {
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
  // Clear the tech's location when they clock out.
  await store.deleteTechLocation(req.org.id, req.viewer.email).catch(() => {});
  res.json({ shift: await store.update('shifts', req.org.id, open.id, { clock_out: new Date().toISOString() }) });
}));

// Scheduled shifts: a manager's PLANNED roster (hours, PTO, sick, call-out)
// for a user/date — distinct from the `shifts` clock above, which is actual
// punches. Everyone can read (techs see only their own, via selfScope);
// only org/manager admins can write (shifts:schedule).
resource('scheduled-shifts', 'scheduled_shifts', 'shifts:schedule', {
  fields: ['user_email', 'date', 'type', 'start_time', 'end_time', 'hours', 'note'],
  ownerField: 'created_by',
  filters: ['user_email', 'date'],
  selfScope: 'user_email',
});

// Technician location tracking. Techs POST their position; the server upserts
// one row per (org, user). Only stored while the tech is clocked in — the
// clock-out handler deletes their row. The workspace must have tech_tracking
// enabled (default on); managers/dispatchers GET all active positions.
app.post('/api/location', requireAuth, wrap(async (req, res) => {
  const ff = req.org.feature_flags || {};
  if (!featureActive(ff, 'tech_tracking')) return res.status(403).json({ error: 'tech tracking disabled' });
  const { lat, lon, accuracy } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') return res.status(400).json({ error: 'lat and lon required' });
  const open = await openShiftFor(req.org.id, req.viewer.email);
  if (!open) return res.status(403).json({ error: 'not clocked in' });
  await store.upsertTechLocation(req.org.id, req.viewer.email, { lat, lon, accuracy, name: req.viewer.name || req.viewer.email });
  res.json({ ok: true });
}));
app.get('/api/tech-locations', requireAuth, requireCapability('tech_locations:read'), wrap(async (req, res) => {
  const ff = req.org.feature_flags || {};
  if (!featureActive(ff, 'tech_tracking')) return res.json([]);
  res.json(await store.getTechLocations(req.org.id));
}));

// Rate limiting state for external OpenStreetMap requests
let lastGeocodeRequestTime = 0;
const GEOCAMP_MUTEX_DELAY = 1000;

app.get('/api/geocode', requireAuth, wrap(async (req, res) => {
  const address = req.query.q;
  if (!address || !address.trim()) {
    return res.status(400).json({ error: 'Address query parameter q is required' });
  }
  const cleanAddress = address.trim();

  // 1. Check database/memory cache
  const cached = await store.getGeocodeCache(cleanAddress);
  if (cached) {
    return res.json({ lat: cached.lat, lon: cached.lon });
  }

  // 2. Fetch from external geocoder
  const AZURE_KEY = process.env.VITE_AZURE_MAPS_KEY;
  let pt = null;

  try {
    if (AZURE_KEY) {
      const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&subscription-key=${AZURE_KEY}&limit=1&query=${encodeURIComponent(cleanAddress)}`;
      const response = await fetch(url);
      const data = await response.json();
      const p = data?.results?.[0]?.position;
      if (p) pt = { lat: p.lat, lon: p.lon };
    } else {
      // Nominatim rate limiting check
      const now = Date.now();
      const elapsed = now - lastGeocodeRequestTime;
      if (elapsed < GEOCAMP_MUTEX_DELAY) {
        await new Promise((resolve) => setTimeout(resolve, GEOCAMP_MUTEX_DELAY - elapsed));
      }
      lastGeocodeRequestTime = Date.now();

      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(cleanAddress)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Dispatch-Agent-Shared-Cache'
        }
      });
      const data = await response.json();
      if (data && data.length > 0) {
        pt = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
    }

    if (pt) {
      // Save to cache
      await store.setGeocodeCache(cleanAddress, pt.lat, pt.lon);
      return res.json(pt);
    }
    
    return res.status(404).json({ error: 'Address not found' });
  } catch (err) {
    console.error('Geocoding error:', err);
    return res.status(502).json({ error: 'Failed to geocode address' });
  }
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
  if (reqRow.user_email && reqRow.user_email !== req.viewer.email) {
    notifyUser(org, reqRow.user_email, 'timesheet_reviewed', { title: `Timesheet correction ${decision}`, body: reqRow.target_date ? `For ${reqRow.target_date}` : '', link: '/timesheets' }).catch(() => {});
  }
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
app.post('/api/work-orders/:id/notify', requireAuth, requireFeature('sms'), requireCapability('work_orders:write'), wrap(async (req, res) => {
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
  // Let the assignee and the creator know it's signed off (never the approver).
  const approveTargets = new Set();
  if (updated.assignee_email && updated.assignee_email !== req.viewer.email) approveTargets.add(updated.assignee_email);
  if (notifiableCreator(updated, req.viewer.email)) approveTargets.add(updated.created_by);
  for (const email of approveTargets) {
    notifyUser(req.org.id, email, 'wo_approved', { title: `${updated.number || 'Work order'} approved`, body: updated.title, link: `/work-orders/${updated.id}` }).catch(() => {});
  }
  res.json(updated);
}));

// (Demo-data seeding moved to the super-admin console — POST
// /api/super/orgs/:id/demo-seed — since it's a platform-operator tool.)

// Full workspace data export (backup / anti-lock-in). Manager-only. Returns a
// single JSON document of every table for this org.
app.get('/api/export', requireAuth, requireFeature('export'), requireCapability('integrations:write'), wrap(async (req, res) => {
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
