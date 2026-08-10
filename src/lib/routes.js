// Top-level path segments that are NOT workspace slugs. Workspaces live at bare
// /:orgSlug/*, so these reserved words route to their own surfaces instead.
export const RESERVED_SEGMENTS = new Set([
  'super-admin', 'sign-in', 'sign-up', 'legal', 'portal', 'api', 'assets', 'media', 'help',
]);
