// Redeems a one-time SESSION handoff token minted by Nexus Command (a
// separate task on Command's side) for Field's own long-lived
// `shared_session` cookie — giving a viewer who signed in/up via Command's
// shared Clerk instance a LASTING session here, not just the ~60s a live
// shared-Clerk token would carry with no refresh mechanism on this side.
//
// This is deliberately a SEPARATE flow from lib/viewAsHandoff.js's
// POST /api/view-as/accept:
//   - view-as/accept lets a Command super-admin IMPERSONATE a Field
//     workspace (grants an org + role via the `view_as` cookie, no real
//     membership, no audit trail here).
//   - session/accept (this file) instead gives an ordinary shared-instance
//     user a standing IDENTITY — no org, no role. What they can see is
//     still decided entirely by resolveViewer's existing membership /
//     app_access lookups (lib/auth.js), exactly as if they'd shown up with
//     a live shared-Clerk Bearer token.
// Both flows share the same signing mechanism and the same
// VIEW_AS_HANDOFF_SECRET, so payload.kind is checked explicitly — a
// view-as-purposed token must never be redeemable here, and a
// session-purposed token must never be redeemable at /api/view-as/accept.
//
// Same hidden-form / same-origin POST pattern as viewAsHandoff.js — see
// that file's header for the full "why a form POST, not fetch" reasoning:
// Command, Field, and CMS sit on three separate root domains, so Command
// can't write a cookie onto Field's origin directly. Instead it hands the
// operator's OWN browser a same-origin top-level POST to make here (not a
// fetch/XHR, so no CORS involved at all), and Field sets its own cookie on
// its own origin.
import express from 'express';
import { verifyViewAsToken, signSharedSessionCookie } from './viewAsToken.js';
import { claimViewAsTokenUse } from './coreAppAccess.js';

// Same content type as viewAsHandoff.js's twin route — Command's frontend
// submits a hidden HTML form (application/x-www-form-urlencoded), a real
// top-level navigation, not fetch/XHR.
const parseForm = express.urlencoded({ extended: false, limit: '4kb' });

export const SHARED_SESSION_COOKIE = 'shared_session';
// Matches signSharedSessionCookie's own baked-in expiry (lib/viewAsToken.js)
// — the cookie's browser-side lifetime and the signed payload's `exp` should
// agree, so an old cookie doesn't linger in the browser past what the
// signature itself would still accept.
const SHARED_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function mountSessionHandoff(app) {
  app.post('/api/session/accept', parseForm, async (req, res) => {
    const token = req.body?.token;
    const payload = verifyViewAsToken(token, { audience: 'field' });
    if (!payload) return res.status(400).send('This sign-in link is invalid or has expired. Return to Nexus Command and try again.');
    // Reject a token minted for a different purpose (view-as impersonation)
    // even though it would otherwise verify fine — kind is checked
    // explicitly, never inferred from audience alone.
    if (payload.kind !== 'session') return res.status(400).send('This link cannot be used to sign in.');
    if (!payload.sub || !payload.email) return res.status(400).send('This sign-in link is invalid or has expired. Return to Nexus Command and try again.');
    // Same single-use enforcement already proven for view-as handoffs — an
    // atomic insert into Core's view_as_token_uses table, shared across every
    // serverless instance.
    if (!(await claimViewAsTokenUse(payload.jti))) return res.status(400).send('This sign-in link has already been used.');
    const cookieValue = signSharedSessionCookie({ sub: payload.sub, email: payload.email });
    if (!cookieValue) return res.status(500).send('Sign-in is not configured on this server.');
    res.cookie(SHARED_SESSION_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production',
      maxAge: SHARED_SESSION_MAX_AGE,
      path: '/',
    });
    res.redirect(302, '/');
  });

  // Clearing removes only this browser's own cookie — not a privilege
  // change, so no auth/token needed (mirrors lib/viewAsHandoff.js's own
  // GET /api/view-as/clear). Wired into sign-out itself (see
  // src/components/Layout.jsx / src/super/SuperLayout.jsx's UserButton
  // afterSignOutUrl) so signing out of Field also drops any shared-session
  // identity, not just an own-instance Clerk session.
  app.get('/api/session/clear', (_req, res) => {
    res.clearCookie(SHARED_SESSION_COOKIE, { path: '/' });
    res.redirect(302, '/');
  });
}
