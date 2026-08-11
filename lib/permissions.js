// Permission catalog — the single source of truth for authorization, shared by
// BOTH the server (enforcement) and the client (nav + Role Editor UI). Keep this
// module pure and dependency-free (no store/server imports) so Vite can bundle
// it into the browser build.
//
// Model: a role's permissions = { pages: [pageKey], caps: [capKey] }.
//   - page membership is the "view" gate (server-enforced on reads),
//   - a capability is an "edit"/action sub-feature within a page.

export const PRESET_ROLES = ['manager_admin', 'accountant_admin', 'dispatcher', 'technician'];
export const ROLE_LABEL = {
  manager_admin: 'Manager Admin',
  accountant_admin: 'Accountant Admin',
  dispatcher: 'Dispatcher',
  technician: 'Technician',
};
// The Technician is a RESTRICTED preset: unlike the others (which read all pages
// for legacy reasons), a technician can only read the pages listed here and only
// their OWN records (work orders assigned to them, their own schedule/time/items
// usage). Enforced in auth.js (readPages) + server.js (self-scoped list filters).
export const TECHNICIAN_PAGES = ['dashboard', 'work_orders', 'schedule', 'items', 'settings'];
export const RESTRICTED_ROLES = ['technician'];
export const isRestrictedRole = (roleKey) => RESTRICTED_ROLES.includes(roleKey);

// capability -> preset roles allowed. The three built-in roles derive their caps
// from this map, so their behavior is identical to before the Role Editor.
// (Reads are gated by page membership; these are write/action capabilities.)
export const CAPABILITIES = {
  'projects:write': ['manager_admin'],
  'punch:write': ['manager_admin', 'dispatcher'],
  'service:write': ['manager_admin', 'accountant_admin'],
  'jobs:write': ['manager_admin', 'dispatcher'],
  // Technicians clock in, log item usage, and post notes/photos — but can't
  // create/edit work orders, items, jobs, or invoices.
  'time:write': ['manager_admin', 'dispatcher', 'technician'],
  'items:write': ['manager_admin', 'accountant_admin'],
  'usage:write': ['manager_admin', 'dispatcher', 'accountant_admin', 'technician'],
  'members:write': ['manager_admin'],
  'attachments:write': ['manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
  'ai:use': ['manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
  'customers:write': ['manager_admin', 'accountant_admin'],
  'sites:write': ['manager_admin', 'accountant_admin', 'dispatcher'],
  'assets:write': ['manager_admin', 'accountant_admin', 'dispatcher'],
  'work_orders:write': ['manager_admin', 'dispatcher'],
  'wo_lines:write': ['manager_admin', 'accountant_admin', 'dispatcher'],
  'invoices:write': ['manager_admin', 'accountant_admin'],
  'invoice_lines:write': ['manager_admin', 'accountant_admin'],
  'work_orders:approve': ['manager_admin'],
  'tickets:write': ['manager_admin', 'accountant_admin', 'dispatcher'],
  'timesheets:review': ['manager_admin'],
  'audit:read': ['manager_admin'],
  'maintenance:write': ['manager_admin', 'accountant_admin', 'dispatcher'],
  'reports:read': ['manager_admin', 'accountant_admin'],
  // Managing custom roles is a workspace-admin power.
  'roles:write': ['manager_admin'],
  // Regions & Teams are manager-admin structure controls.
  'regions:write': ['manager_admin'],
  'teams:write': ['manager_admin'],
  // Tech location tracking: who can SEE where techs are on the map.
  'tech_locations:read': ['manager_admin', 'dispatcher'],
};

export const CAP_LABEL = {
  'tech_locations:read': 'View technician locations on map',
  'work_orders:write': 'Create / edit work orders',
  'work_orders:approve': 'Approve (sign-off) work orders',
  'wo_lines:write': 'Edit work-order line items',
  'customers:write': 'Edit customer accounts',
  'sites:write': 'Edit sites',
  'assets:write': 'Edit assets / equipment',
  'invoices:write': 'Create / edit invoices',
  'invoice_lines:write': 'Edit invoice line items',
  'maintenance:write': 'Edit maintenance plans',
  'jobs:write': 'Create / edit dispatch jobs',
  'projects:write': 'Create / edit projects',
  'punch:write': 'Edit punch-list items',
  'items:write': 'Edit item catalog',
  'usage:write': 'Record item usage',
  'reports:read': 'View financial reports',
  'time:write': 'Clock in/out & edit time',
  'timesheets:review': 'Review timesheet requests',
  'members:write': 'Manage team members',
  'service:write': 'Edit service offers & rates',
  'roles:write': 'Manage roles & permissions',
  'regions:write': 'Manage regions',
  'teams:write': 'Manage teams',
  'tickets:write': 'Reply to customer tickets',
  'audit:read': 'View activity log',
  'attachments:write': 'Add photos & notes',
  'ai:use': 'Use the AI assistant',
};

// Ordered page catalog. `collections` are the DB tables whose GET routes require
// view access to this page. `navRoles` (when present) encodes today's nav gating
// so preset roles reproduce exactly. `alwaysVisible` pages can't be hidden.
// `view: false` pages own no nav item (they're pure data groupings).
export const PAGES = [
  { key: 'dashboard', label: 'Dashboard', path: '/', collections: [], caps: [], alwaysVisible: true },
  { key: 'work_orders', label: 'Work Orders', path: '/work-orders', collections: ['work_orders', 'work_order_lines'], caps: ['work_orders:write', 'wo_lines:write', 'work_orders:approve'] },
  { key: 'tickets', label: 'Tickets', path: '/tickets', collections: ['tickets', 'ticket_messages'], caps: ['tickets:write'] },
  { key: 'schedule', label: 'Schedule', path: '/schedule', collections: [], caps: [] },
  { key: 'customers', label: 'Customers', path: '/customers', collections: ['customers', 'sites', 'assets'], caps: ['customers:write', 'sites:write', 'assets:write'] },
  { key: 'invoices', label: 'Invoices', path: '/invoices', collections: ['invoices', 'invoice_lines'], caps: ['invoices:write', 'invoice_lines:write'], navRoles: ['manager_admin', 'accountant_admin'] },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', collections: ['maintenance_plans'], caps: ['maintenance:write'] },
  { key: 'dispatch', label: 'Dispatch', path: '/dispatch', collections: ['jobs'], caps: ['jobs:write'] },
  { key: 'map', label: 'Map', path: '/map', collections: [], caps: [] },
  { key: 'projects', label: 'Projects', path: '/projects', collections: ['projects', 'punch_items'], caps: ['projects:write', 'punch:write'] },
  { key: 'items', label: 'Items', path: '/items', collections: ['items', 'item_usage'], caps: ['items:write', 'usage:write'] },
  { key: 'reports', label: 'Reports', path: '/reports', collections: [], caps: ['reports:read'], navRoles: ['manager_admin', 'accountant_admin'] },
  { key: 'timesheets', label: 'Timesheets', path: '/timesheets', collections: ['time_entries'], caps: ['time:write', 'timesheets:review'], navRoles: ['manager_admin', 'accountant_admin'] },
  { key: 'team', label: 'Users', path: '/team', collections: [], caps: ['members:write'] },
  { key: 'audit', label: 'Activity', path: '/audit', collections: [], caps: ['audit:read'], navRoles: ['manager_admin'] },
  { key: 'settings', label: 'Settings', path: '/settings', collections: ['service_offers'], caps: ['service:write', 'members:write', 'roles:write'], alwaysVisible: true },
];

// Optional modules a workspace can turn on/off (Super Admin → Integrations &
// Features). Each maps to a nav page that's hidden on the client when disabled.
// Default is ON — a flag only hides when explicitly set to false.
export const FEATURE_FLAGS = [
  { key: 'tickets', label: 'Customer tickets', page: 'tickets' },
  { key: 'maintenance', label: 'Preventive maintenance', page: 'maintenance' },
  { key: 'projects', label: 'Projects & punch lists', page: 'projects' },
  { key: 'map', label: 'Map view', page: 'map' },
  { key: 'dispatch', label: 'Dispatch board', page: 'dispatch' },
];

// Workspace-level toggles that don't gate a whole nav page — shown separately
// in Super Admin workspace settings. Default ON unless explicitly false.
export const WORKSPACE_FEATURES = [
  { key: 'tech_tracking', label: 'Technician location tracking', description: 'Show technician GPS positions on the map when clocked in (managers & dispatchers only).' },
];
// Third-party integrations a workspace may use. Gating is enforced server-side
// (see /api/integrations/*) and reflected in the workspace's Settings.
export const INTEGRATION_FLAGS = [
  { key: 'intacct', label: 'Sage Intacct' },
];
// A feature is enabled unless the workspace's flags explicitly disable it.
export const featureEnabled = (flags, key) => flags?.features?.[key] !== false;
// The set of page keys hidden by disabled features (for client nav filtering).
export const disabledFeaturePages = (flags) =>
  FEATURE_FLAGS.filter((f) => !featureEnabled(flags, f.key)).map((f) => f.page);

export const PAGE_KEYS = PAGES.map((p) => p.key);
export const ALL_CAPS = Object.keys(CAPABILITIES);

// collection (DB table) -> page key, for server read-gating.
export const COLLECTION_PAGE = Object.fromEntries(
  PAGES.flatMap((p) => (p.collections || []).map((c) => [c, p.key])),
);

// A preset role's resolved permissions, derived from CAPABILITIES + nav gating so
// the three built-ins behave exactly as before.
export function presetPerms(roleKey) {
  if (!PRESET_ROLES.includes(roleKey)) return null;
  const caps = ALL_CAPS.filter((c) => CAPABILITIES[c].includes(roleKey));
  // The technician sees an explicit, restricted page allowlist (not the
  // legacy "every page without navRoles" set).
  if (roleKey === 'technician') return { pages: TECHNICIAN_PAGES.filter((k) => PAGE_KEYS.includes(k)), caps };
  const pages = PAGES.filter((p) => p.alwaysVisible || !p.navRoles || p.navRoles.includes(roleKey)).map((p) => p.key);
  return { pages, caps };
}

export const emptyPerms = () => ({ pages: ['dashboard'], caps: [] });

// Keep only known page/cap keys — an allowlist so a client can never inject an
// unknown permission. Dashboard is always viewable (route-guard fallback).
export function sanitizePerms(perms = {}) {
  const pages = Array.isArray(perms.pages) ? perms.pages.filter((k) => PAGE_KEYS.includes(k)) : [];
  const caps = Array.isArray(perms.caps) ? perms.caps.filter((k) => ALL_CAPS.includes(k)) : [];
  if (!pages.includes('dashboard')) pages.unshift('dashboard');
  return { pages: [...new Set(pages)], caps: [...new Set(caps)] };
}
