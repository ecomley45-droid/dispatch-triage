import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, CAPABILITIES, ROLES } from '../lib/auth.js';

test('the built-in roles exist', () => {
  assert.deepEqual([...ROLES].sort(), ['accountant_admin', 'dispatcher', 'manager_admin', 'org_admin', 'technician']);
});

test('org_admin can do everything', () => {
  for (const cap of Object.keys(CAPABILITIES)) assert.ok(can('org_admin', cap), `org_admin should have ${cap}`);
});

test('manager_admin runs operations but not high-risk config', () => {
  for (const cap of ['work_orders:write', 'work_orders:approve', 'members:write', 'invoices:write', 'reports:read', 'timesheets:review', 'audit:read']) {
    assert.ok(can('manager_admin', cap), `manager should have ${cap}`);
  }
  for (const cap of ['roles:write', 'regions:write', 'teams:write', 'integrations:write']) {
    assert.ok(!can('manager_admin', cap), `manager must NOT have ${cap} (org_admin only)`);
  }
});

test('dispatcher: field ops yes, money/admin no', () => {
  assert.ok(can('dispatcher', 'jobs:write'));
  assert.ok(can('dispatcher', 'punch:write'));
  assert.ok(can('dispatcher', 'time:write'));
  assert.ok(can('dispatcher', 'usage:write'));
  assert.ok(can('dispatcher', 'attachments:write'));
  assert.ok(!can('dispatcher', 'items:write'), 'dispatcher must not edit item costs');
  assert.ok(!can('dispatcher', 'service:write'), 'dispatcher must not set service rates');
  assert.ok(!can('dispatcher', 'projects:write'));
  assert.ok(!can('dispatcher', 'members:write'), 'dispatcher must not manage the team');
});

test('accountant_admin: costs/rates yes, dispatch no', () => {
  assert.ok(can('accountant_admin', 'items:write'));
  assert.ok(can('accountant_admin', 'service:write'));
  assert.ok(can('accountant_admin', 'usage:write'));
  assert.ok(!can('accountant_admin', 'jobs:write'), 'accountant is read-only on dispatch');
  assert.ok(!can('accountant_admin', 'projects:write'));
  assert.ok(!can('accountant_admin', 'members:write'));
});

test('only manager can manage members', () => {
  assert.ok(can('manager_admin', 'members:write'));
  assert.ok(!can('accountant_admin', 'members:write'));
  assert.ok(!can('dispatcher', 'members:write'));
});

test('unknown role or capability is denied', () => {
  assert.ok(!can('intruder', 'items:write'));
  assert.ok(!can('manager_admin', 'nonexistent:write'));
});
