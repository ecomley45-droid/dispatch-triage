import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformAdmin } from '../lib/auth.js';
import { store } from '../lib/store.js';

// --- Platform-admin gate ---------------------------------------------------
test('isPlatformAdmin: dev-bypass viewer is always a platform admin', () => {
  assert.equal(isPlatformAdmin({ _dev: true, email: 'dev@localhost' }), true);
});

test('isPlatformAdmin: only allowlisted emails pass (case-insensitive)', () => {
  const prev = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = 'boss@nexus.example, ops@nexus.example';
  try {
    assert.equal(isPlatformAdmin({ email: 'BOSS@nexus.example' }), true);
    assert.equal(isPlatformAdmin({ email: 'ops@nexus.example' }), true);
    assert.equal(isPlatformAdmin({ email: 'someone@client.example' }), false);
    assert.equal(isPlatformAdmin(null), false);
  } finally { process.env.PLATFORM_ADMIN_EMAILS = prev; }
});

// --- Cross-workspace org management (in-memory backend) --------------------
test('store.createOrg + listOrgs: new workspace appears with its first admin', async () => {
  const id = 'test-ws-alpha';
  const org = await store.createOrg({ id, name: 'Alpha Clinic', plan: 'pro', first_admin_email: 'owner@alpha.example' });
  assert.equal(org.id, id);
  assert.equal(org.plan, 'pro');

  const orgs = await store.listOrgs();
  const found = orgs.find((o) => o.id === id);
  assert.ok(found, 'created workspace is listed');
  assert.equal(found.member_count, 1, 'first admin counted as a member');

  const membership = await store.orgForUser('owner@alpha.example');
  assert.equal(membership.role, 'manager_admin', 'first admin is a Manager Admin');
});

test('store.createOrg: duplicate id is rejected', async () => {
  const id = 'test-ws-dupe';
  await store.createOrg({ id, name: 'Dupe One' });
  await assert.rejects(() => store.createOrg({ id, name: 'Dupe Two' }), /already exists/);
});

test('store.updateOrg: branding merge is reflected in orgForUser', async () => {
  const id = 'test-ws-brand';
  await store.createOrg({ id, name: 'Brand Co', first_admin_email: 'a@brand.example' });
  await store.updateOrg(id, { branding: { primaryColor: '#7c3aed', displayName: 'Brand Co' } });
  const m = await store.orgForUser('a@brand.example');
  assert.equal(m.branding.primaryColor, '#7c3aed');
  assert.equal(m.branding.displayName, 'Brand Co');
});

// --- URL-selected workspace scoping (/space/:slug via X-Workspace) ----------
test('orgForUser(email, slug): scopes to that workspace only for a member', async () => {
  await store.createOrg({ id: 'ws-multi-a', name: 'Alpha', first_admin_email: 'multi@user.example' });
  await store.createOrg({ id: 'ws-multi-b', name: 'Beta', first_admin_email: 'multi@user.example' });
  const a = await store.orgForUser('multi@user.example', 'ws-multi-a');
  const b = await store.orgForUser('multi@user.example', 'ws-multi-b');
  assert.equal(a.id, 'ws-multi-a');
  assert.equal(b.id, 'ws-multi-b');
});

test('orgForUser(email, slug): returns null when the user is not a member (no cross-tenant leak)', async () => {
  await store.createOrg({ id: 'ws-private', name: 'Private', first_admin_email: 'owner@private.example' });
  const forged = await store.orgForUser('outsider@nope.example', 'ws-private');
  assert.equal(forged, null);
});

test('listMembershipsForUser: returns every workspace the user belongs to', async () => {
  await store.createOrg({ id: 'ws-list-1', name: 'One', first_admin_email: 'lister@user.example' });
  await store.createOrg({ id: 'ws-list-2', name: 'Two', first_admin_email: 'lister@user.example' });
  const list = await store.listMembershipsForUser('lister@user.example');
  const ids = list.map((m) => m.id).sort();
  assert.deepEqual(ids, ['ws-list-1', 'ws-list-2']);
});
