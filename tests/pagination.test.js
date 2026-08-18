import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLimit, orderCol, DEFAULT_LIMIT, MAX_LIMIT, store } from '../lib/store.js';

// clampLimit normalizes untrusted ?limit values to a bounded integer or null.
test('clampLimit: absent → null (caller applies its own default)', () => {
  assert.equal(clampLimit(undefined), null);
  assert.equal(clampLimit(null), null);
  assert.equal(clampLimit(''), null);
});

test('clampLimit: garbage / non-positive → DEFAULT_LIMIT', () => {
  assert.equal(clampLimit('abc'), DEFAULT_LIMIT);
  assert.equal(clampLimit('0'), DEFAULT_LIMIT);
  assert.equal(clampLimit('-5'), DEFAULT_LIMIT);
});

test('clampLimit: over the cap is clamped to MAX_LIMIT', () => {
  assert.equal(clampLimit('100000'), MAX_LIMIT);
  assert.equal(clampLimit(String(MAX_LIMIT + 1)), MAX_LIMIT);
});

test('clampLimit: a sane value passes through, floored', () => {
  assert.equal(clampLimit('25'), 25);
  assert.equal(clampLimit('25.9'), 25);
});

test('orderCol: item_usage sorts by used_at, everything else by created_at', () => {
  assert.equal(orderCol('item_usage'), 'used_at');
  assert.equal(orderCol('projects'), 'created_at');
  assert.equal(orderCol('jobs'), 'created_at');
});

// The in-memory store honors { limit, before } for keyset pagination. Uses the
// seeded demo org so we exercise the real code path (no Supabase configured).
const ORG = 'demo';

test('store.list: limit bounds the page size', async () => {
  const all = await store.list('items', ORG);
  assert.ok(all.length >= 3, 'demo seed has ≥3 items');
  const page = await store.list('items', ORG, {}, { limit: 2 });
  assert.equal(page.length, 2);
});

test('store.list: before cursor returns strictly older rows (no overlap)', async () => {
  const col = orderCol('items');
  const first = await store.list('items', ORG, {}, { limit: 2 });
  const cursor = first[first.length - 1][col];
  const next = await store.list('items', ORG, {}, { limit: 10, before: cursor });
  // Every next-page row is older than the cursor, and none repeats the page.
  const firstIds = new Set(first.map((r) => r.id));
  for (const r of next) {
    assert.ok(String(r[col]) < String(cursor), 'row is older than cursor');
    assert.ok(!firstIds.has(r.id), 'no overlap with the first page');
  }
});
