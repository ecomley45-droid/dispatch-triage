// Symmetric encryption for user-supplied integration secrets stored at rest
// (e.g. a workspace's Sage Intacct credentials). AES-256-GCM with a key derived
// from SECRETS_KEY. Secrets are server-only and are NEVER placed in
// orgs.feature_flags (which is sent to the browser) — they live in the
// `integrations` table, encrypted with these helpers.
import crypto from 'node:crypto';

export const secretsConfigured = () => !!process.env.SECRETS_KEY;

// Derive a stable 32-byte key from the env secret (scrypt with a fixed salt so
// the same SECRETS_KEY always yields the same key — required to decrypt later).
let cachedKey = null;
function key() {
  if (!process.env.SECRETS_KEY) throw new Error('SECRETS_KEY is not set — cannot store integration secrets. Set a strong SECRETS_KEY in the server environment.');
  if (!cachedKey) cachedKey = crypto.scryptSync(process.env.SECRETS_KEY, 'nexus-integrations-v1', 32);
  return cachedKey;
}

// Encrypt a UTF-8 string → "v1:<iv>:<tag>:<ciphertext>" (all base64). Returns
// null for empty input so callers can treat "no value" uniformly.
export function encryptSecret(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Decrypt a value produced by encryptSecret. Returns null on empty/garbled input
// (never throws to the request path — a rotated key just means "no usable secret").
export function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string' || !blob.startsWith('v1:')) return null;
  try {
    const [, ivB, tagB, ctB] = blob.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
