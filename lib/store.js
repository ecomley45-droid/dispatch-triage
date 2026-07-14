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
const orderCol = (collection) => ORDER_COL[collection] || 'created_at';

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------
const mem = {
  orgs: new Map(),
  org_members: [], // { org_id, user_email, name, role }
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
}

const memApi = {
  async getOrg(id) { seedDemo(); return mem.orgs.get(id) || null; },
  async updateOrg(id, patch) {
    seedDemo();
    const o = mem.orgs.get(id);
    if (!o) return null;
    Object.assign(o, patch, { updated_at: now() });
    return o;
  },
  async orgForUser(email) {
    seedDemo();
    const m = mem.org_members.find((x) => x.user_email === String(email).toLowerCase());
    if (!m) return null;
    const org = mem.orgs.get(m.org_id);
    return org ? { id: org.id, slug: org.id, name: org.name, role: m.role, feature_flags: org.feature_flags } : null;
  },
  async listMembers(orgId) { seedDemo(); return mem.org_members.filter((m) => m.org_id === orgId); },
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
  async list(collection, orgId, filters = {}) {
    seedDemo();
    let rows = [...coll(collection).values()].filter((r) => r.org_id === orgId);
    for (const [k, v] of Object.entries(filters)) rows = rows.filter((r) => r[k] === v);
    const col = orderCol(collection);
    return rows.sort((a, b) => String(b[col] || '').localeCompare(String(a[col] || '')));
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
const sbApi = {
  async getOrg(id) {
    const { data } = await db().from('orgs').select('*').eq('id', id).maybeSingle();
    return data || null;
  },
  async updateOrg(id, patch) {
    const { data, error } = await db().from('orgs').update({ ...patch, updated_at: now() }).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data || null;
  },
  async orgForUser(email) {
    const { data } = await db().from('org_members').select('org_id, role, orgs(id, name, feature_flags)')
      .eq('user_email', String(email).toLowerCase()).limit(1).maybeSingle();
    if (!data?.orgs) return null;
    return { id: data.orgs.id, slug: data.orgs.id, name: data.orgs.name, role: data.role, feature_flags: data.orgs.feature_flags };
  },
  async listMembers(orgId) {
    const { data } = await db().from('org_members').select('*').eq('org_id', orgId);
    return data || [];
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
  async list(collection, orgId, filters = {}) {
    let q = db().from(collection).select('*').eq('org_id', orgId).order(orderCol(collection), { ascending: false });
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async getById(collection, orgId, id) {
    const { data } = await db().from(collection).select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
    return data || null;
  },
  async insert(collection, orgId, data) {
    const { data: row, error } = await db().from(collection).insert({ ...data, org_id: orgId }).select().single();
    if (error) throw error;
    return row;
  },
  async update(collection, orgId, id, patch) {
    const { data: row, error } = await db().from(collection)
      .update({ ...patch, org_id: orgId }).eq('org_id', orgId).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return row || null;
  },
  async remove(collection, orgId, id) {
    const { error, count } = await db().from(collection).delete({ count: 'exact' }).eq('org_id', orgId).eq('id', id);
    if (error) throw error;
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
