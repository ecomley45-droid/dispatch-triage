import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/store.js';

test('store geocoding cache operations', async () => {
  const address = '1600 Amphitheatre Pkwy, Mountain View, CA';
  
  // 1. Check cache initially empty
  const cachedInitial = await store.getGeocodeCache(address);
  assert.equal(cachedInitial, null);

  // 2. Set cache
  await store.setGeocodeCache(address, 37.4220, -122.0841);

  // 3. Get cache again
  const cachedAfter = await store.getGeocodeCache(address);
  assert.ok(cachedAfter);
  assert.equal(cachedAfter.lat, 37.4220);
  assert.equal(cachedAfter.lon, -122.0841);

  // 4. Case insensitivity check
  const cachedLower = await store.getGeocodeCache(address.toLowerCase());
  assert.ok(cachedLower);
  assert.equal(cachedLower.lat, 37.4220);
});
