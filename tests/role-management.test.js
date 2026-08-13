import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/store.js';
import { resolveRolePerms, invalidateRoleCache } from '../lib/auth.js';

const ORG = 'family-dental';

// Platform default (Super Admin) replaces a preset's pages AND caps everywhere.
test('platform role default overrides preset pages + caps', async () => {
  await store.setRoleDefault('dispatcher', { pages: ['dashboard', 'work_orders'], caps: ['work_orders:write'] });
  invalidateRoleCache();
  const p = await resolveRolePerms(ORG, 'dispatcher');
  assert.deepEqual([...p.pages].sort(), ['dashboard', 'work_orders']);
  assert.ok(p.caps.has('work_orders:write'));
  // Reads now follow the effective pages (customers no longer readable).
  assert.ok(p.readPages.has('work_orders'));
  assert.ok(!p.readPages.has('customers'));
});

// A workspace page override beats the platform default; caps still come from
// the platform (workspaces can't change capabilities).
test('workspace page override wins for pages, keeps platform caps', async () => {
  await store.setRoleDefault('dispatcher', { pages: ['dashboard', 'work_orders'], caps: ['work_orders:write'] });
  await store.setRoleMeta(ORG, 'dispatcher', { permissions: { pages: ['dashboard', 'items'] } });
  invalidateRoleCache();
  const p = await resolveRolePerms(ORG, 'dispatcher');
  assert.deepEqual([...p.pages].sort(), ['dashboard', 'items']);
  assert.ok(p.caps.has('work_orders:write'), 'caps still from platform default');
});

// Hiding a built-in role is recorded on its per-workspace row.
test('a preset can be hidden per workspace', async () => {
  await store.setRoleMeta(ORG, 'accountant_admin', { hidden: true });
  const row = await store.getRole(ORG, 'accountant_admin');
  assert.equal(row.hidden, true);
});
