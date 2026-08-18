// Shared with the browser build (like lib/permissions.js) — keep this
// dependency-free. Server-side (server.js) uses FONT_FAMILY_KEYS to validate
// a workspace's branding.fontFamily against an allowlist rather than storing
// an arbitrary string; the client (src/components/Layout.jsx) maps each key
// to its actual CSS font stack.
export const FONT_FAMILY_KEYS = ['default', 'classic', 'mono', 'rounded'];
