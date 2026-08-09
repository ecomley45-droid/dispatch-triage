import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWebhook } from '../lib/payments.js';

const secret = 'whsec_test';
const sign = (payload, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

test('verifyWebhook accepts a correctly signed, fresh payload', () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed' });
  const event = verifyWebhook(Buffer.from(payload), sign(payload), secret);
  assert.equal(event?.type, 'checkout.session.completed');
});

test('verifyWebhook rejects a tampered signature', () => {
  const payload = JSON.stringify({ type: 'x' });
  assert.equal(verifyWebhook(Buffer.from(payload), 't=' + Math.floor(Date.now() / 1000) + ',v1=deadbeef', secret), null);
});

test('verifyWebhook rejects an old timestamp (replay)', () => {
  const payload = JSON.stringify({ type: 'x' });
  const old = Math.floor(Date.now() / 1000) - 10000;
  assert.equal(verifyWebhook(Buffer.from(payload), sign(payload, old), secret), null);
});

test('verifyWebhook rejects when the body is altered after signing', () => {
  const sig = sign(JSON.stringify({ amount: 100 }));
  assert.equal(verifyWebhook(Buffer.from(JSON.stringify({ amount: 999 })), sig, secret), null);
});
