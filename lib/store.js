// Org-scoped data layer with two interchangeable backends:
//
//   - Supabase (when SUPABASE_URL + SERVICE_ROLE_KEY are set) — persistent.
//   - In-memory (otherwise) — seeded demo data, resets on restart. Lets the
//     whole app run with zero external services for local dev / demos.
//
// Every function takes orgId as its first argument. org_id is never accepted
// from the client — server.js injects it from the authenticated viewer.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const now = () => new Date().toISOString();

// Most tables sort newest-first by created_at, but a few use a different
// timestamp column (item_usage has no created_at — it uses used_at).
const ORDER_COL = { item_usage: 'used_at' };
export const orderCol = (collection) => ORDER_COL[collection] || 'created_at';

// Pagination: every interactive list is bounded. Callers pass { limit, before }
// where `before` is a keyset cursor — the order-column value of the last row of
// the previous page (rows strictly older than it come next). Aggregate/backup
// callers (dashboard, export) pass no limit and intentionally read the full set.
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// Normalize a client-supplied limit to a bounded integer, or null (= no cap).
export function clampLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------
const mem = {
  orgs: new Map(),
  org_members: [], // { org_id, user_email, name, role }
  roles: new Map(), // `${org_id}:${key}` -> { org_id, key, name, permissions }
  collections: new Map(), // name -> Map(id -> row)
};

function coll(name) {
  if (!mem.collections.has(name)) mem.collections.set(name, new Map());
  return mem.collections.get(name);
}

let seeded = false;
function seedDemo() {
  if (seeded) return;
  seeded = true;

  const orgId = 'family-dental';
  mem.orgs.set(orgId, {
    id: orgId,
    name: 'Family Dental Health',
    plan: 'starter',
    feature_flags: {},
    branding: {},
    stripe_customer_id: null,
    stripe_subscription_id: null,
    subscription_status: null,
    billing_email: null,
    created_at: now(),
    updated_at: now(),
  });

  const admins = (process.env.ADMIN_EMAILS || 'ecomley45@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const email of admins) {
    mem.org_members.push({ org_id: orgId, user_email: email, name: 'Owner', role: 'manager_admin', joined_at: now() });
  }
  mem.org_members.push(
    { org_id: orgId, user_email: 'dev@localhost', name: 'Dev Admin', role: 'manager_admin', joined_at: now() },
    { org_id: orgId, user_email: 'accountant@familydental.example', name: 'Alex Books', role: 'accountant_admin', joined_at: now() },
    { org_id: orgId, user_email: 'dispatch@familydental.example', name: 'Dana Dispatch', role: 'dispatcher', joined_at: now() },
  );

  const proj = { id: randomUUID(), org_id: orgId, name: 'North Clinic Buildout', client_name: 'Family Dental — North', location: '1200 Oak Ave', status: 'active', budget: 85000, start_date: '2026-06-01', due_date: '2026-09-15', description: 'New operatory buildout and equipment install.', created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  coll('projects').set(proj.id, proj);

  const punch = [
    { title: 'Chair #3 water line leaking', status: 'open', priority: 'high', assignee_email: 'dispatch@familydental.example' },
    { title: 'Replace compressor filter', status: 'in_progress', priority: 'medium', assignee_email: 'dispatch@familydental.example' },
    { title: 'Cabinet door misaligned — op 2', status: 'done', priority: 'low' },
  ];
  for (const p of punch) {
    const id = randomUUID();
    coll('punch_items').set(id, { id, org_id: orgId, project_id: proj.id, description: '', photo_url: null, created_by: 'dev@localhost', created_at: now(), completed_at: p.status === 'done' ? now() : null, ...p });
  }

  const svc = { id: randomUUID(), org_id: orgId, name: 'Standard Service Call', description: 'On-site diagnostic + labor', unit: 'hour', default_rate: 125, active: true, created_at: now() };
  coll('service_offers').set(svc.id, svc);

  const job = { id: randomUUID(), org_id: orgId, project_id: proj.id, service_offer_id: svc.id, title: 'Install operatory chair #4', location: '1200 Oak Ave', status: 'scheduled', scheduled_start: '2026-07-15T09:00:00Z', scheduled_end: '2026-07-15T13:00:00Z', assignee_email: 'dispatch@familydental.example', dispatcher_email: 'dev@localhost', notes: 'Bring lift kit.', created_at: now(), updated_at: now() };
  coll('jobs').set(job.id, job);

  const items = [
    { name: 'Nitrile Gloves (box)', sku: 'GLV-100', unit: 'box', unit_cost: 12.5 },
    { name: 'Compressor Filter', sku: 'FLT-22', unit: 'each', unit_cost: 34.0 },
    { name: 'Dental Chair Water Line', sku: 'WL-08', unit: 'each', unit_cost: 58.75 },
  ];
  const itemIds = [];
  for (const it of items) {
    const id = randomUUID();
    itemIds.push(id);
    coll('items').set(id, { id, org_id: orgId, image_url: null, created_at: now(), updated_at: now(), ...it });
  }
  const use = { id: randomUUID(), org_id: orgId, item_id: itemIds[1], project_id: proj.id, job_id: job.id, quantity: 2, unit_cost_at_use: 34.0, used_at: now(), recorded_by: 'dispatch@familydental.example', notes: '' };
  coll('item_usage').set(use.id, use);

  // ---- CRM spine demo: a business customer with two sites, assets, a work order ----
  const cust = { id: randomUUID(), org_id: orgId, name: 'Riverside Dental Partners', billing_email: 'ap@riverside-dental.example', phone: '(555) 210-4488', billing_address: '900 Riverside Blvd, Suite 200', payment_terms: 'net_30', po_required: true, status: 'active', notes: 'Multi-location group; PO required on all work.', portal_token: randomUUID(), created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  coll('customers').set(cust.id, cust);

  const siteN = { id: randomUUID(), org_id: orgId, customer_id: cust.id, name: 'Riverside — North Clinic', address: '1200 Oak Ave', access_notes: 'Enter through rear; key code 4471. Open 7a–5p.', contact_name: 'Priya Shah', contact_phone: '(555) 210-4490', status: 'active', created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  const siteE = { id: randomUUID(), org_id: orgId, customer_id: cust.id, name: 'Riverside — East Clinic', address: '52 Commerce Way', access_notes: 'Front desk will buzz you in.', contact_name: 'Marco Ruiz', contact_phone: '(555) 210-4491', status: 'active', created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  coll('sites').set(siteN.id, siteN);
  coll('sites').set(siteE.id, siteE);

  const chair = { id: randomUUID(), org_id: orgId, customer_id: cust.id, site_id: siteN.id, name: 'Operatory Chair #3', category: 'dental_chair', manufacturer: 'A-dec', model: '511', serial: 'ADC-511-88213', install_date: '2023-04-10', warranty_expires: '2027-04-10', status: 'needs_service', notes: 'Water line intermittently leaks.', created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  const comp = { id: randomUUID(), org_id: orgId, customer_id: cust.id, site_id: siteN.id, name: 'Air Compressor (mechanical rm)', category: 'compressor', manufacturer: 'Midmark', model: 'PowerAir P32', serial: 'MID-P32-4471', install_date: '2022-11-01', warranty_expires: '2025-11-01', status: 'active', notes: '', created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  coll('assets').set(chair.id, chair);
  coll('assets').set(comp.id, comp);

  const slaDue = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const wo = { id: randomUUID(), org_id: orgId, number: 'WO-0001', customer_id: cust.id, site_id: siteN.id, asset_id: chair.id, title: 'Chair #3 water line leaking', description: 'Water pooling under operatory chair #3. Suspect cracked supply line.', priority: 'high', status: 'scheduled', assignee_email: 'dispatch@familydental.example', requested_by: 'Priya Shah', sla_due: slaDue, scheduled_start: '2026-08-10T09:00:00Z', scheduled_end: '2026-08-10T11:00:00Z', completed_at: null, resolution_notes: '', signature_url: null, signature_name: null, created_by: 'dev@localhost', created_at: now(), updated_at: now() };
  coll('work_orders').set(wo.id, wo);

  const lines = [
    { kind: 'labor', description: 'Diagnostic + supply-line replacement', quantity: 2, unit_cost: 0, unit_price: 125 },
    { kind: 'part', description: 'Dental Chair Water Line (WL-08)', quantity: 1, unit_cost: 58.75, unit_price: 89, item_id: itemIds[2] },
  ];
  for (const l of lines) {
    const id = randomUUID();
    coll('work_order_lines').set(id, { id, org_id: orgId, work_order_id: wo.id, item_id: null, created_at: now(), ...l });
  }
}

const memApi = {
  async getOrg(id) { seedDemo(); return mem.orgs.get(id) || null; },
  async listOrgs() {
    seedDemo();
    // Attach lightweight member counts; other counts are computed lazily by the
    // caller when it drills into a workspace.
    return [...mem.orgs.values()]
      .map((o) => ({ ...o, member_count: mem.org_members.filter((m) => m.org_id === o.id).length }))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  },
  async createOrg({ id, name, plan = 'starter', branding = {}, first_admin_email = null }) {
    seedDemo();
    if (mem.orgs.has(id)) throw new Error(`Workspace "${id}" already exists`);
    const org = { id, name, plan, feature_flags: {}, branding, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null, billing_email: first_admin_email, created_at: now(), updated_at: now() };
    mem.orgs.set(id, org);
    if (first_admin_email) {
      mem.org_members.push({ org_id: id, user_email: String(first_admin_email).toLowerCase(), name: null, role: 'manager_admin', invited_at: now(), joined_at: null });
    }
    return org;
  },
  async updateOrg(id, patch) {
    seedDemo();
    const o = mem.orgs.get(id);
    if (!o) return null;
    Object.assign(o, patch, { updated_at: now() });
    return o;
  },
  async orgForUser(email, slug = null) {
    seedDemo();
    const e = String(email).toLowerCase();
    // With a slug, resolve THAT workspace (and only if the user is a member);
    // without one, fall back to the user's first membership (default workspace).
    const m = slug
      ? mem.org_members.find((x) => x.user_email === e && x.org_id === slug)
      : mem.org_members.find((x) => x.user_email === e);
    if (!m) return null;
    const org = mem.orgs.get(m.org_id);
    return org ? { id: org.id, slug: org.id, name: org.name, role: m.role, feature_flags: org.feature_flags, branding: org.branding || {} } : null;
  },
  async listMembershipsForUser(email) {
    seedDemo();
    const e = String(email).toLowerCase();
    return mem.org_members
      .filter((x) => x.user_email === e)
      .map((m) => { const org = mem.orgs.get(m.org_id); return org ? { id: org.id, name: org.name, role: m.role } : null; })
      .filter(Boolean);
  },
  // --- Custom roles (per workspace; presets live in code, not here) ---
  async listRoles(orgId) {
    seedDemo();
    return [...mem.roles.values()].filter((r) => r.org_id === orgId);
  },
  async getRole(orgId, key) {
    seedDemo();
    return mem.roles.get(`${orgId}:${key}`) || null;
  },
  async createRole(orgId, { key, name, permissions }) {
    seedDemo();
    const id = `${orgId}:${key}`;
    if (mem.roles.has(id)) throw new Error(`Role "${key}" already exists`);
    const row = { org_id: orgId, key, name, permissions, created_at: now(), updated_at: now() };
    mem.roles.set(id, row);
    return row;
  },
  async updateRole(orgId, key, patch) {
    seedDemo();
    const row = mem.roles.get(`${orgId}:${key}`);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.permissions !== undefined) row.permissions = patch.permissions;
    row.updated_at = now();
    return row;
  },
  async deleteRole(orgId, key) {
    seedDemo();
    return mem.roles.delete(`${orgId}:${key}`);
  },
  async listMembers(orgId) { seedDemo(); return mem.org_members.filter((m) => m.org_id === orgId); },
  async customerByPortalToken(token) {
    seedDemo();
    return [...coll('customers').values()].find((c) => c.portal_token === token) || null;
  },
  async addMember(orgId, { user_email, name, role }) {
    seedDemo();
    const email = String(user_email).toLowerCase();
    const existing = mem.org_members.find((m) => m.org_id === orgId && m.user_email === email);
    if (existing) { existing.role = role; existing.name = name ?? existing.name; return existing; }
    const row = { org_id: orgId, user_email: email, name: name || null, role, invited_at: now(), joined_at: null };
    mem.org_members.push(row);
    return row;
  },
  async updateMember(orgId, userEmail, patch) {
    seedDemo();
    const email = String(userEmail).toLowerCase();
    const m = mem.org_members.find((x) => x.org_id === orgId && x.user_email === email);
    if (!m) return null;
    if (patch.role !== undefined) m.role = patch.role;
    if (patch.name !== undefined) m.name = patch.name;
    return m;
  },
  async removeMember(orgId, userEmail) {
    seedDemo();
    const email = String(userEmail).toLowerCase();
    const before = mem.org_members.length;
    mem.org_members = mem.org_members.filter((m) => !(m.org_id === orgId && m.user_email === email));
    return mem.org_members.length < before;
  },
  async list(collection, orgId, filters = {}, { limit = null, before = null } = {}) {
    seedDemo();
    const col = orderCol(collection);
    let rows = [...coll(collection).values()].filter((r) => r.org_id === orgId);
    for (const [k, v] of Object.entries(filters)) rows = rows.filter((r) => r[k] === v);
    rows.sort((a, b) => String(b[col] || '').localeCompare(String(a[col] || '')));
    if (before) rows = rows.filter((r) => String(r[col] || '') < String(before));
    if (limit != null) rows = rows.slice(0, limit);
    return rows;
  },
  async getById(collection, orgId, id) {
    seedDemo();
    const r = coll(collection).get(id);
    return r && r.org_id === orgId ? r : null;
  },
  async insert(collection, orgId, data) {
    seedDemo();
    const id = data.id || randomUUID();
    const row = { id, org_id: orgId, created_at: now(), ...data };
    coll(collection).set(id, row);
    return row;
  },
  async update(collection, orgId, id, patch) {
    seedDemo();
    const r = coll(collection).get(id);
    if (!r || r.org_id !== orgId) return null;
    const updated = { ...r, ...patch, id, org_id: orgId, updated_at: now() };
    coll(collection).set(id, updated);
    return updated;
  },
  async remove(collection, orgId, id) {
    seedDemo();
    const r = coll(collection).get(id);
    if (!r || r.org_id !== orgId) return false;
    coll(collection).delete(id);
    return true;
  },
};

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

// A deploy can land ahead of its DB migrations. Detect "relation/column does
// not exist" (Postgres 42P01/42703 or PostgREST's schema-cache codes) so that
// reads degrade to empty (pages still render) and writes surface a clear
// "run the migrations" message instead of an opaque 500. See db/migrations/.
const MIGRATE_MSG = 'This feature needs a database update — run the SQL in db/migrations/ against your database, then retry.';
function isMissingSchema(e) {
  const code = e?.code || '';
  const msg = e?.message || '';
  return ['42P01', '42703', 'PGRST205', 'PGRST204', 'PGRST202'].includes(code) || /does not exist|schema cache/i.test(msg);
}
// Re-throw a Supabase write error, mapping missing-schema to the friendly message.
function rethrowWrite(error) {
  throw isMissingSchema(error) ? new Error(MIGRATE_MSG) : error;
}

const sbApi = {
  async getOrg(id) {
    const { data } = await db().from('orgs').select('*').eq('id', id).maybeSingle();
    return data || null;
  },
  async listOrgs() {
    const { data, error } = await db().from('orgs').select('*').order('created_at', { ascending: false });
    if (error) { if (isMissingSchema(error)) return []; throw error; }
    return data || [];
  },
  async createOrg({ id, name, plan = 'starter', branding = {}, first_admin_email = null }) {
    const { data, error } = await db().from('orgs')
      .insert({ id, name, plan, feature_flags: {}, branding, billing_email: first_admin_email })
      .select().single();
    if (error) rethrowWrite(error);
    if (first_admin_email) {
      await db().from('org_members').upsert(
        { org_id: id, user_email: String(first_admin_email).toLowerCase(), role: 'manager_admin' },
        { onConflict: 'org_id,user_email' },
      );
    }
    return data;
  },
  async updateOrg(id, patch) {
    const { data, error } = await db().from('orgs').update({ ...patch, updated_at: now() }).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data || null;
  },
  async orgForUser(email, slug = null) {
    const user = String(email).toLowerCase();
    // With a slug, scope to that workspace (membership check via the join);
    // without one, take the first membership. `branding` is a newer column;
    // on a deploy that lands ahead of its migration, selecting it errors — fall
    // back to the pre-branding shape so the client still resolves the workspace.
    const run = (cols) => {
      let q = db().from('org_members').select(`org_id, role, orgs(${cols})`).eq('user_email', user);
      if (slug) q = q.eq('org_id', slug);
      return q.limit(1).maybeSingle();
    };
    let { data, error } = await run('id, name, feature_flags, branding');
    if (error && isMissingSchema(error)) ({ data } = await run('id, name, feature_flags'));
    if (!data?.orgs) return null;
    return { id: data.orgs.id, slug: data.orgs.id, name: data.orgs.name, role: data.role, feature_flags: data.orgs.feature_flags, branding: data.orgs.branding || {} };
  },
  async listMembershipsForUser(email) {
    const { data, error } = await db().from('org_members').select('role, orgs(id, name)')
      .eq('user_email', String(email).toLowerCase());
    if (error) { if (isMissingSchema(error)) return []; throw error; }
    return (data || []).filter((r) => r.orgs).map((r) => ({ id: r.orgs.id, name: r.orgs.name, role: r.role }));
  },
  // --- Custom roles (per workspace) ---
  async listRoles(orgId) {
    const { data, error } = await db().from('roles').select('*').eq('org_id', orgId).order('name');
    if (error) { if (isMissingSchema(error)) return []; throw error; }
    return data || [];
  },
  async getRole(orgId, key) {
    const { data, error } = await db().from('roles').select('*').eq('org_id', orgId).eq('key', key).maybeSingle();
    if (error && !isMissingSchema(error)) throw error;
    return data || null;
  },
  async createRole(orgId, { key, name, permissions }) {
    const { data, error } = await db().from('roles').insert({ org_id: orgId, key, name, permissions }).select().single();
    if (error) rethrowWrite(error);
    return data;
  },
  async updateRole(orgId, key, patch) {
    const clean = {};
    if (patch.name !== undefined) clean.name = patch.name;
    if (patch.permissions !== undefined) clean.permissions = patch.permissions;
    const { data, error } = await db().from('roles').update({ ...clean, updated_at: now() })
      .eq('org_id', orgId).eq('key', key).select().maybeSingle();
    if (error) rethrowWrite(error);
    return data || null;
  },
  async deleteRole(orgId, key) {
    const { error, count } = await db().from('roles').delete({ count: 'exact' }).eq('org_id', orgId).eq('key', key);
    if (error) rethrowWrite(error);
    return (count ?? 0) > 0;
  },
  async listMembers(orgId) {
    const { data } = await db().from('org_members').select('*').eq('org_id', orgId);
    return data || [];
  },
  async customerByPortalToken(token) {
    const { data } = await db().from('customers').select('*').eq('portal_token', token).maybeSingle();
    return data || null;
  },
  async addMember(orgId, { user_email, name, role }) {
    const row = { org_id: orgId, user_email: String(user_email).toLowerCase(), name: name || null, role };
    const { data, error } = await db().from('org_members').upsert(row, { onConflict: 'org_id,user_email' }).select().single();
    if (error) throw error;
    return data;
  },
  async updateMember(orgId, userEmail, patch) {
    const clean = {};
    if (patch.role !== undefined) clean.role = patch.role;
    if (patch.name !== undefined) clean.name = patch.name;
    const { data, error } = await db().from('org_members').update(clean)
      .eq('org_id', orgId).eq('user_email', String(userEmail).toLowerCase()).select().maybeSingle();
    if (error) throw error;
    return data || null;
  },
  async removeMember(orgId, userEmail) {
    const { error, count } = await db().from('org_members').delete({ count: 'exact' })
      .eq('org_id', orgId).eq('user_email', String(userEmail).toLowerCase());
    if (error) throw error;
    return (count ?? 0) > 0;
  },
  async list(collection, orgId, filters = {}, { limit = null, before = null } = {}) {
    const col = orderCol(collection);
    let q = db().from(collection).select('*').eq('org_id', orgId).order(col, { ascending: false });
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (before) q = q.lt(col, before);
    if (limit != null) q = q.limit(limit);
    const { data, error } = await q;
    if (error) { if (isMissingSchema(error)) return []; throw error; }
    return data || [];
  },
  async getById(collection, orgId, id) {
    const { data, error } = await db().from(collection).select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (error && !isMissingSchema(error)) throw error;
    return data || null;
  },
  async insert(collection, orgId, data) {
    const { data: row, error } = await db().from(collection).insert({ ...data, org_id: orgId }).select().single();
    if (error) rethrowWrite(error);
    return row;
  },
  async update(collection, orgId, id, patch) {
    const { data: row, error } = await db().from(collection)
      .update({ ...patch, org_id: orgId }).eq('org_id', orgId).eq('id', id).select().maybeSingle();
    if (error) rethrowWrite(error);
    return row || null;
  },
  async remove(collection, orgId, id) {
    const { error, count } = await db().from(collection).delete({ count: 'exact' }).eq('org_id', orgId).eq('id', id);
    if (error) rethrowWrite(error);
    return (count ?? 0) > 0;
  },
};

// Pick backend at call time so tests / env changes are honored.
const backend = () => (db() ? sbApi : memApi);

export const store = new Proxy({}, {
  get(_t, prop) {
    return (...args) => backend()[prop](...args);
  },
});
