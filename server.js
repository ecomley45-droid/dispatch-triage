import dotenv from 'dotenv';
// Clerk CLI writes keys to .env.local; load it first (wins), then .env fills gaps.
dotenv.config({ path: '.env.local' });
dotenv.config();
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { store } from './lib/store.js';
import { isSupabaseConfigured } from './lib/db.js';
import {
  attachClerk, assertProductionAuth, resolveViewer,
  requireAuth, requireCapability, can, CAPABILITIES,
} from './lib/auth.js';

assertProductionAuth();

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(helmet({ contentSecurityPolicy: false })); // CSP tuned per-deploy; off in dev
app.use(express.json({ limit: '2mb' }));
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

const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`Dispatch API on :${port} — data backend: ${isSupabaseConfigured() ? 'Supabase' : 'in-memory (demo)'}`);
});
