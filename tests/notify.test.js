import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, smsEnabled } from '../lib/notify.js';

test('normalizePhone handles common US formats', () => {
  assert.equal(normalizePhone('(555) 774-1903'), '+15557741903');
  assert.equal(normalizePhone('555-774-1903'), '+15557741903');
  assert.equal(normalizePhone('15557741903'), '+15557741903');
  assert.equal(normalizePhone('+1 555 774 1903'), '+15557741903');
});

test('normalizePhone returns null for empties', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('smsEnabled is false without Twilio env', () => {
  assert.equal(smsEnabled(), false);
});
