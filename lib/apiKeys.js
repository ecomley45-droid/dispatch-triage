// Public API key generation/verification. Mirrors nexus-core's
// packages/standards/src/api-key-auth.js inline rather than depending on it
// as a package — same "deploys independently, can't depend on a sibling
// local repo" reasoning as lib/coreAppAccess.js (a file: dependency on a
// sibling checkout doesn't resolve in Vercel's build, which only clones
// this repo). If nexus-standards is ever published to a private registry,
// this file can be replaced by a thin re-export.
//
// Never store the raw key. generateKey() returns it once; the caller shows
// it to the user once (Stripe/GitHub-style) and stores only key_prefix +
// hashKey(raw).
import crypto from 'node:crypto';
import { store } from './store.js';

const RANDOM_BYTES = 24;

export function generateKey(prefix = 'nf_live') {
  const token = crypto.randomBytes(RANDOM_BYTES).toString('base64url');
  return { raw: `${prefix}_${token}`, keyPrefix: `${prefix}_${token.slice(0, 8)}` };
}

export function hashKey(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function parseKeyPrefix(rawKey) {
  const parts = String(rawKey || '').split('_');
  if (parts.length < 2) return null;
  const token = parts[parts.length - 1];
  if (token.length < 8) return null;
  return `${parts.slice(0, -1).join('_')}_${token.slice(0, 8)}`;
}

// Verifies a raw key against this org's api_keys table. Returns the row
// (with caps/org_id) on success, null on any failure — unknown prefix, hash
// mismatch, or a revoked key (checked by the caller via revoked_at, same as
// nexus-standards' verifyApiKey leaving "what counts as invalid" to the
// caller).
export async function verifyApiKey(rawKey) {
  const keyPrefix = parseKeyPrefix(rawKey);
  if (!keyPrefix) return null;
  const row = await store.getApiKeyByPrefix(keyPrefix);
  if (!row?.key_hash || row.revoked_at) return null;
  const expected = Buffer.from(row.key_hash, 'hex');
  const actual = Buffer.from(hashKey(rawKey), 'hex');
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  store.touchApiKey(row.id).catch(() => {}); // best-effort last_used_at, never blocks the request
  return row;
}
