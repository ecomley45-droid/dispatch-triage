// Verifies the short-lived "view-as" handoff token Nexus Command mints
// (nexus-core's apps/command/lib/viewAsToken.js) when it issues a view-as
// grant. See that file's header for the full design rationale (hand-rolled
// HMAC, a dedicated VIEW_AS_HANDOFF_SECRET distinct from
// SHARED_CLERK_SECRET_KEY). Hand-duplicated here rather than imported —
// separate repos/deploys, same pattern as lib/dualAuth.js.
//
// Field never SIGNS one of THESE tokens (only Command issues view-as
// grants), so only the verify half lives here for that pair. (Below, a
// second, unrelated pair — signSharedSessionCookie/verifySharedSessionCookie
// — DOES sign, for a different purpose: see that section's own header.)
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

// --- Shared-session cookie (long-lived, self-issued) ---
//
// NOT the same trust model as verifyViewAsToken above. That pair verifies a
// SINGLE-USE, 60s-TTL handoff token that Command signs and Field only ever
// verifies once (via claimViewAsTokenUse) before discarding it. The pair
// below SIGNS and verifies Field's own long-lived `shared_session` cookie —
// re-verified on every request for up to 30 days, with no single-use
// tracking (a cookie is read repeatedly by design; there is no jti to
// claim). It exists to give a viewer who arrived via a Command-issued
// SESSION handoff (see lib/sessionHandoff.js) a LASTING sign-in on Field,
// since a copied Clerk JWT would expire in ~60s with no refresh mechanism
// here.
//
// Reuses the exact same HMAC mechanics as verifyViewAsToken (HMAC-SHA256
// over a base64url-encoded JSON payload, keyed by the same
// VIEW_AS_HANDOFF_SECRET) — just a different payload shape and a much
// longer expiry. Do not confuse the two: a verifyViewAsToken payload is a
// one-time grant Field never signs; a signSharedSessionCookie payload is a
// standing identity claim Field signs and re-checks itself, every request,
// for weeks.
const SHARED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function signSharedSessionCookie({ sub, email }) {
  if (!SECRET || !sub || !email) return null;
  const exp = Math.floor(Date.now() / 1000) + SHARED_SESSION_TTL_SECONDS;
  const encoded = b64url(JSON.stringify({ sub, email, exp }));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySharedSessionCookie(value) {
  if (!SECRET || !value || typeof value !== 'string') return null;
  const parts = value.split('.');
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
  if (!payload.sub || !payload.email) return null;
  return { sub: payload.sub, email: payload.email };
}
