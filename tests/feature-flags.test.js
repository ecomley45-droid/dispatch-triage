import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  featureActive, disabledFeaturePages, disabledFeatureCaps, FEATURE_FLAGS,
} from '../lib/permissions.js';

// A workspace with no flags set has every feature on (default-on).
test('everything is active by default', () => {
  for (const f of FEATURE_FLAGS) assert.ok(featureActive({}, f.key), `${f.key} should default on`);
  assert.deepEqual(disabledFeaturePages({}), []);
  assert.deepEqual(disabledFeatureCaps({}), []);
});

// Turning a feature off explicitly disables it and hides its page(s) + cap(s).
test('an explicit off disables just that feature', () => {
  const flags = { features: { invoicing: false } };
  assert.equal(featureActive(flags, 'invoicing'), false);
  assert.ok(disabledFeaturePages(flags).includes('invoices'));
  assert.ok(disabledFeatureCaps(flags).includes('invoices:write'));
  // A sibling is untouched.
  assert.ok(featureActive(flags, 'work_orders'));
});

// Dependencies cascade: killing a prerequisite takes its dependents with it,
// so the workspace can never reach an incoherent state.
test('disabling a prerequisite cascades to dependents', () => {
  const flags = { features: { customers: false } };
  for (const key of ['work_orders', 'invoicing', 'tickets', 'maintenance', 'portal']) {
    assert.equal(featureActive(flags, key), false, `${key} should follow customers off`);
  }
  // Approval requires work_orders, which requires customers — transitive.
  assert.equal(featureActive(flags, 'approval'), false);
  // An unrelated feature stays on.
  assert.ok(featureActive(flags, 'items'));
});

// The GPS → map chain: turning off time tracking cascades two levels.
test('tech tracking + map cascade off time tracking', () => {
  const flags = { features: { time_tracking: false } };
  assert.equal(featureActive(flags, 'tech_tracking'), false);
  assert.equal(featureActive(flags, 'map'), false);
  assert.ok(disabledFeaturePages(flags).includes('map'));
  assert.ok(disabledFeaturePages(flags).includes('timesheets'));
});
