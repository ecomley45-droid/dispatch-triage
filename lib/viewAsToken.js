// Verifies the short-lived "view-as" handoff token Nexus Command mints
// (nexus-core's apps/command/lib/viewAsToken.js) when it issues a view-as
// grant. See that file's header for the full design rationale (hand-rolled
// HMAC, a dedicated VIEW_AS_HANDOFF_SECRET distinct from
// SHARED_CLERK_SECRET_KEY). Hand-duplicated here rather than imported —
// separate repos/deploys, same pattern as lib/dualAuth.js.
//
// Field never SIGNS a token (only Command issues grants), so only the
// verify half lives here.
import crypto from 'crypto';

const SECRET = process.env.VIEW_AS_HANDOFF_SECRET || '';

const b64url = (input) => Buffer.from(input).toString('base64url');
const sign = (encoded) => b64url(crypto.createHmac('sha256', SECRET).update(encoded).digest());

export function verifyViewAsToken(token, { audience } = {}) {
  if (!SECRET || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let expected;
  try {
    expected = sign(encoded);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (audience && payload.aud !== audience) return null;
  return payload;
}
