// Fallback identity source: the shared "Comley Nexus" Clerk instance
// (comley-nexus-ecosystem-migration-plan.md Phase C, piloted here — new
// engineering, not a copy of a proven pattern, since Clerk's SDKs assume one
// instance per app). Tried ONLY when this app's own clerkMiddleware() found
// no session for the request — an existing own-instance session always wins
// and this is never consulted. Existing users are completely unaffected;
// this only recognizes *new* sign-ins that arrive via the shared instance
// (e.g. from Nexus Command).
//
// Uses @clerk/backend's low-level verifyToken() directly rather than a
// second clerkMiddleware(), since Clerk's own middleware is hardcoded to one
// instance. Networked (fetches that instance's JWKS) — no local secret
// derivation shortcuts taken.

import { verifyToken, createClerkClient } from '@clerk/backend';

const SHARED_SECRET_KEY = process.env.SHARED_CLERK_SECRET_KEY;
const sharedClient = SHARED_SECRET_KEY ? createClerkClient({ secretKey: SHARED_SECRET_KEY }) : null;

function extractToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.__session || null;
}

// Returns the same shape loadClerkUser() produces ({ userId, email, name,
// image }), or null if there's no valid shared-instance session. Never
// throws — a malformed/expired/foreign token just means "not this either,"
// same as no token at all.
export async function loadSharedViewer(req) {
  if (!sharedClient) return null;
  const token = extractToken(req);
  if (!token) return null;
  let verified;
  try {
    verified = await verifyToken(token, { secretKey: SHARED_SECRET_KEY });
  } catch {
    return null;
  }
  try {
    const user = await sharedClient.users.getUser(verified.sub);
    const email = (user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || '').toLowerCase();
    if (!email) return null;
    return {
      userId: verified.sub,
      email,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email,
      image: user?.imageUrl || null,
    };
  } catch {
    return null;
  }
}
