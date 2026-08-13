import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetPerms, sanitizePerms, PAGE_KEYS, CAPABILITIES } from '../lib/permissions.js';
import { resolveRolePerms, can } from '../lib/auth.js';
import { store } from '../lib/store.js';

// --- Presets reproduce the pre-Role-Editor behavior (regression guard) -------
test('preset caps match the CAPABILITIES map exactly', () => {
  for (const role of ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician']) {
    const caps = new Set(presetPerms(role).caps);
    for (const cap of Object.keys(CAPABILITIES)) {
      assert.equal(caps.has(cap), CAPABILITIES[cap].includes(role), `${role} × ${cap}`);
    }
  }
});

test('preset page visibility matches the old nav gating', () => {
  assert.ok(presetPerms('manager_admin').pages.includes('audit'), 'manager sees audit');
  assert.ok(!presetPerms('accountant_admin').pages.includes('audit'), 'accountant has no audit');
  const disp = presetPerms('dispatcher').pages;
  for (const hidden of ['invoices', 'reports', 'timesheets', 'audit']) assert.ok(!disp.includes(hidden), `dispatcher no ${hidden}`);
  for (const shown of ['work_orders', 'customers', 'dispatch', 'items', 'team']) assert.ok(disp.includes(shown), `dispatcher sees ${shown}`);
});

test('technician is a restricted preset: limited pages, view-only work orders', async () => {
  const t = presetPerms('technician');
  assert.deepEqual(t.pages.sort(), ['dashboard', 'items', 'schedule', 'settings', 'work_orders']);
  assert.ok(!t.caps.includes('work_orders:write'), 'technician cannot edit work orders');
  assert.ok(!t.caps.includes('items:write'), 'technician cannot edit the item catalog');
  for (const c of ['time:write', 'usage:write', 'attachments:write']) assert.ok(t.caps.includes(c), `technician can ${c}`);
  const p = await resolveRolePerms('family-dental', 'technician');
  assert.ok(!p.readPages.has('customers'), 'technician cannot read customers data');
  assert.ok(p.readPages.has('work_orders'), 'technician can read (own) work orders');
});

// --- resolveRolePerms: presets read everything; customs are scoped -----------
test('resolveRolePerms: presets can read every page (legacy reads-open behavior)', async () => {
  const p = await resolveRolePerms('family-dental', 'dispatcher');
  for (const key of PAGE_KEYS) assert.ok(p.readPages.has(key), `dispatcher preset readPages ${key}`);
  // ...but nav pages stay restricted
  assert.ok(!p.pages.has('invoices'));
});

test('resolveRolePerms: unknown role resolves to deny (dashboard only)', async () => {
  const p = await resolveRolePerms('family-dental', 'no-such-role');
  assert.deepEqual([...p.caps], []);
  assert.deepEqual([...p.pages], ['dashboard']);
  assert.deepEqual([...p.readPages], ['dashboard']);
});

// --- Custom role CRUD + scoping ---------------------------------------------
test('custom role: create, resolve scoped reads, then delete', async () => {
  const org = 'roles-test-ws';
  await store.createOrg({ id: org, name: 'Roles Test', first_admin_email: 'admin@rt.example' });
  await store.createRole(org, { key: 'front-desk', name: 'Front Desk', permissions: sanitizePerms({ pages: ['customers', 'schedule'], caps: ['customers:write'] }) });

  const p = await resolveRolePerms(org, 'front-desk');
  assert.ok(p.pages.has('customers') && p.pages.has('schedule') && p.pages.has('dashboard'));
  assert.ok(!p.pages.has('invoices'));
  // custom roles read ONLY what they can see
  assert.ok(p.readPages.has('customers') && !p.readPages.has('invoices'));
  assert.ok(p.caps.has('customers:write') && !p.caps.has('invoices:write'));

  const list = await store.listRoles(org);
  assert.equal(list.length, 1);
  assert.ok(await store.deleteRole(org, 'front-desk'));
  assert.equal((await store.listRoles(org)).length, 0);
});

test('sanitizePerms drops unknown keys and always includes dashboard', () => {
  const p = sanitizePerms({ pages: ['customers', 'bogus-page'], caps: ['customers:write', 'bogus:cap'] });
  assert.ok(p.pages.includes('customers') && p.pages.includes('dashboard'));
  assert.ok(!p.pages.includes('bogus-page'));
  assert.deepEqual(p.caps, ['customers:write']);
});

// `can` still works for presets (used elsewhere).
test('can() preset check still holds', () => {
  assert.ok(can('org_admin', 'roles:write'));
  assert.ok(!can('manager_admin', 'roles:write'), 'roles:write moved to org_admin');
  assert.ok(!can('dispatcher', 'roles:write'));
});
