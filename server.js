import dotenv from 'dotenv';
// Clerk CLI writes keys to .env.local; load it first (wins), then .env fills gaps.
dotenv.config({ path: '.env.local' });
dotenv.config();
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
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
app.set('trust proxy', true); // correct req.protocol/host behind Vercel's proxy
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(helmet({ contentSecurityPolicy: false })); // CSP tuned per-deploy; off in dev
app.use(express.json({ limit: '8mb' })); // headroom for base64 image uploads
app.use(cookieParser());
attachClerk(app);
app.use(resolveViewer);

// --- Identity: who am I, what workspace, what can I do ---
app.get('/api/health', (_req, res) => res.json({ ok: true, backend: isSupabaseConfigured() ? 'supabase' : 'memory' }));

app.get('/api/me', requireAuth, (req, res) => {
  const caps = Object.keys(CAPABILITIES).filter((c) => can(req.viewer.role, c));
  res.json({ viewer: req.viewer, org: req.org, capabilities: caps });
});

app.get('/api/members', requireAuth, async (req, res) => {
  res.json(await store.listMembers(req.org.id));
});

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Invite a member: pre-adds them to org_members with a role. They gain access
// on their first sign-in with that email (Microsoft or otherwise).
app.post('/api/members', requireAuth, requireCapability('members:write'), async (req, res) => {
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
});

app.patch('/api/members/:email', requireAuth, requireCapability('members:write'), async (req, res) => {
  const { role, name } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: `Invalid role` });
  const row = await store.updateMember(req.org.id, req.params.email, { role, name });
  if (!row) return res.status(404).json({ error: 'Member not found' });
  res.json(row);
});

app.delete('/api/members/:email', requireAuth, requireCapability('members:write'), async (req, res) => {
  // Guard against removing yourself — avoids locking the last manager out.
  if (req.params.email.toLowerCase() === req.viewer.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't remove yourself" });
  }
  const ok = await store.removeMember(req.org.id, req.params.email);
  res.status(ok ? 204 : 404).end();
});

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

  app.get(`/api/${path}`, requireAuth, async (req, res) => {
    const f = {};
    for (const key of filters) if (req.query[key]) f[key] = req.query[key];
    res.json(await store.list(collection, req.org.id, f));
  });

  app.get(`/api/${path}/:id`, requireAuth, async (req, res) => {
    const row = await store.getById(collection, req.org.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.post(`/api/${path}`, requireAuth, requireCapability(writeCap), async (req, res) => {
    const data = pick(req.body);
    if (ownerField) data[ownerField] = req.viewer.email;
    res.status(201).json(await store.insert(collection, req.org.id, data));
  });

  app.patch(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), async (req, res) => {
    const row = await store.update(collection, req.org.id, req.params.id, pick(req.body));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.delete(`/api/${path}/:id`, requireAuth, requireCapability(writeCap), async (req, res) => {
    const ok = await store.remove(collection, req.org.id, req.params.id);
    res.status(ok ? 204 : 404).end();
  });
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

// --- Serve the built SPA in production ---
const dist = join(__dirname, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

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
