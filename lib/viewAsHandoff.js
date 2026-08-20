// Redeems a view-as handoff token minted by Nexus Command
// (POST /api/impersonate/field/:orgId in nexus-core's apps/command/server.js)
// for Field's own first-party `view_as` cookie.
//
// Why this exists: Command, Field, and CMS are on three different root
// domains today (comleynexus.com / app.nexusfieldhub.com / nexuscmshub.com),
// so a cookie Command's browser session carries can never be read here — no
// shared cookie domain exists to rely on. Rather than loosening CORS/
// SameSite to allow a cross-origin cookie write (real attack-surface
// expansion: any origin allowed through that door could ride a signed-in
// platform admin's browser to open a workspace), Command instead mints a
// short-lived signed token and hands the OPERATOR'S OWN BROWSER a same-
// origin POST to make here. That's a normal top-level form navigation, not
// a fetch/XHR, so it isn't subject to CORS at all — and Field then sets its
// OWN cookie, on its OWN origin, which SameSite:Lax already allows.
//
// The token itself never touches a URL bar, browser history, or Referer
// header — Command's frontend builds a hidden <form method="POST"> and
// submits it, so the token travels only in that one request body.
//
// Single-use: claimViewAsTokenUse (lib/coreAppAccess.js) claims the token's
// jti in Core's view_as_token_uses table (an atomic insert; a conflict
// means replay). Previously this was an in-memory Map, which only caught a
// replay within one serverless instance and missed it across Vercel's
// multiple instances — that gap is closed now that the claim lives in Core,
// shared by every instance.
import express from 'express';
import { verifyViewAsToken } from './viewAsToken.js';
import { claimViewAsTokenUse } from './coreAppAccess.js';
import { store } from './store.js';
import { PRESET_ROLES } from './permissions.js';

// Same content type as CMS's twin route -- Command's frontend submits a
// hidden HTML form (application/x-www-form-urlencoded), a real top-level
// navigation, not fetch/XHR, so it sidesteps CORS entirely.
const parseForm = express.urlencoded({ extended: false, limit: '4kb' });

const VIEW_AS_MAX_AGE = 4 * 60 * 60 * 1000; // 4h -- matches server.js's own view-as cookie

// Mirrors server.js's own assignableRole() (hand-duplicated, not exported
// from there) -- a role is assignable if it's a non-hidden preset, or a
// custom role that actually exists for this org.
async function assignableRole(orgId, key) {
  if (!key) return false;
  if (PRESET_ROLES.includes(key)) return !(await store.getRole(orgId, key).catch(() => null))?.hidden;
  return !!(await store.getRole(orgId, key));
}

export function mountViewAsHandoff(app) {
  app.post('/api/view-as/accept', parseForm, async (req, res) => {
    const token = req.body?.token;
    const payload = verifyViewAsToken(token, { audience: 'field' });
    if (!payload) return res.status(400).send('This view-as link is invalid or has expired. Return to Nexus Command and try again.');
    if (!(await claimViewAsTokenUse(payload.jti))) return res.status(400).send('This view-as link has already been used.');
    const org = await store.getOrg(payload.orgId).catch(() => null);
    if (!org) return res.status(404).send('Workspace not found.');
    const role = (await assignableRole(org.id, payload.role)) ? payload.role : 'manager_admin';
    res.cookie('view_as', JSON.stringify({ org: org.id, role }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production',
      maxAge: VIEW_AS_MAX_AGE,
      path: '/',
    });
    res.redirect(302, '/super-admin');
  });

  // Clearing removes only this browser's own cookie -- not a privilege
  // grant, so no auth/token needed (mirrors server.js's own
  // POST /api/super/view-as/clear, just reachable without a Field session
  // so Command can link straight to it).
  app.get('/api/view-as/clear', (_req, res) => {
    res.clearCookie('view_as', { path: '/' });
    res.redirect(302, '/');
  });
}
