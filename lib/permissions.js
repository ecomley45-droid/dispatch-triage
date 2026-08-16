// Permission catalog — the single source of truth for authorization, shared by
// BOTH the server (enforcement) and the client (nav + Role Editor UI). Keep this
// module pure and dependency-free (no store/server imports) so Vite can bundle
// it into the browser build.
//
// Model: a role's permissions = { pages: [pageKey], caps: [capKey] }.
//   - page membership is the "view" gate (server-enforced on reads),
//   - a capability is an "edit"/action sub-feature within a page.

// Ordered high → low. org_admin is the tenant owner/super-user: it alone holds
// the high-blast-radius config powers (roles, regions/teams, integrations, data
// export). manager_admin runs operations (a team/region) but can't reconfigure
// the workspace — see CAPABILITIES below.
export const PRESET_ROLES = ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician'];
export const ROLE_LABEL = {
  org_admin: 'Org Admin',
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
// org_admin is a superset — it appears in every capability. manager_admin holds
// all the OPERATIONAL capabilities but NOT the four high-blast-radius config
// powers (roles, regions, teams, integrations), which are org_admin-only.
export const CAPABILITIES = {
  'projects:write': ['org_admin', 'manager_admin'],
  'punch:write': ['org_admin', 'manager_admin', 'dispatcher'],
  'service:write': ['org_admin', 'manager_admin', 'accountant_admin'],
  'jobs:write': ['org_admin', 'manager_admin', 'dispatcher'],
  // Technicians clock in, log item usage, and post notes/photos — but can't
  // create/edit work orders, items, jobs, or invoices.
  'time:write': ['org_admin', 'manager_admin', 'dispatcher', 'technician'],
  'items:write': ['org_admin', 'manager_admin', 'accountant_admin'],
  'usage:write': ['org_admin', 'manager_admin', 'dispatcher', 'accountant_admin', 'technician'],
  'members:write': ['org_admin', 'manager_admin'],
  'attachments:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
  'ai:use': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
  'customers:write': ['org_admin', 'manager_admin', 'accountant_admin'],
  'sites:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'],
  'assets:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'],
  'work_orders:write': ['org_admin', 'manager_admin', 'dispatcher'],
  'wo_lines:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'],
  'invoices:write': ['org_admin', 'manager_admin', 'accountant_admin'],
  'invoice_lines:write': ['org_admin', 'manager_admin', 'accountant_admin'],
  'work_orders:approve': ['org_admin', 'manager_admin'],
  'tickets:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'],
  'timesheets:review': ['org_admin', 'manager_admin'],
  'audit:read': ['org_admin', 'manager_admin'],
  'maintenance:write': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'],
  'reports:read': ['org_admin', 'manager_admin', 'accountant_admin'],
  // --- Org-admin-only configuration powers (high blast radius) ---
  // Managing roles & permissions is the workspace owner's power, not a manager's.
  'roles:write': ['org_admin'],
  // Regions & Teams are org-structure controls.
  'regions:write': ['org_admin'],
  'teams:write': ['org_admin'],
  // Connecting accounting integrations and exporting all workspace data.
  'integrations:write': ['org_admin'],
  // Tech location tracking: who can SEE where techs are on the map.
  'tech_locations:read': ['org_admin', 'manager_admin', 'dispatcher'],
  // Planned roster hours (shift/PTO/sick/call-out) — a manager's scheduling
  // power, not a dispatcher's; techs can read their own but never write.
  'shifts:schedule': ['org_admin', 'manager_admin'],
  // Field-tech work-order updates: status (a restricted subset — en route/on
  // site/completed), resolution notes, and customer sign-off. Deliberately
  // narrower than work_orders:write (no priority/assignee/schedule editing).
  'work_orders:tech_update': ['org_admin', 'manager_admin', 'dispatcher', 'technician'],
  // Quick-create a catalog item (name/SKU/cost/photo) from the field — not the
  // same as items:write, which also grants editing/deleting existing items.
  'items:create': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
  // Add an item-only work-order line (no cost/price — that's wo_lines:write's
  // job). What a tech needs: "I used this part," not "here's what to bill."
  'wo_lines:add_item': ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher', 'technician'],
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
  'integrations:write': 'Manage integrations & data export',
  'tickets:write': 'Reply to customer tickets',
  'audit:read': 'View activity log',
  'attachments:write': 'Add photos & notes',
  'ai:use': 'Use the AI assistant',
  'shifts:schedule': 'Set scheduled hours / PTO / sick / call-out',
  'work_orders:tech_update': 'Update job status, resolution & sign-off (field tech)',
  'items:create': 'Quick-add a catalog item from the field',
  'wo_lines:add_item': 'Add an item used (no cost/price) to a work order',
};

// Ordered page catalog. `collections` are the DB tables whose GET routes require
// view access to this page. `navRoles` (when present) encodes today's nav gating
// so preset roles reproduce exactly. `alwaysVisible` pages can't be hidden.
// `view: false` pages own no nav item (they're pure data groupings).
export const PAGES = [
  { key: 'dashboard', label: 'Dashboard', path: '/', collections: [], caps: [], alwaysVisible: true },
  { key: 'work_orders', label: 'Work Orders', path: '/work-orders', collections: ['work_orders', 'work_order_lines'], caps: ['work_orders:write', 'wo_lines:write', 'work_orders:approve', 'work_orders:tech_update', 'wo_lines:add_item'] },
  { key: 'tickets', label: 'Tickets', path: '/tickets', collections: ['tickets', 'ticket_messages'], caps: ['tickets:write'] },
  { key: 'schedule', label: 'Schedule', path: '/schedule', collections: ['scheduled_shifts'], caps: ['shifts:schedule'] },
  { key: 'customers', label: 'Customers', path: '/customers', collections: ['customers', 'sites', 'assets'], caps: ['customers:write', 'sites:write', 'assets:write'] },
  { key: 'invoices', label: 'Invoices', path: '/invoices', collections: ['invoices', 'invoice_lines'], caps: ['invoices:write', 'invoice_lines:write'], navRoles: ['org_admin', 'manager_admin', 'accountant_admin'] },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', collections: ['maintenance_plans'], caps: ['maintenance:write'] },
  { key: 'dispatch', label: 'Dispatch', path: '/dispatch', collections: ['jobs'], caps: ['jobs:write'] },
  { key: 'map', label: 'Map', path: '/map', collections: [], caps: [] },
  { key: 'projects', label: 'Projects', path: '/projects', collections: ['projects', 'punch_items'], caps: ['projects:write', 'punch:write'] },
  { key: 'items', label: 'Items', path: '/items', collections: ['items', 'item_usage'], caps: ['items:write', 'usage:write', 'items:create'] },
  { key: 'reports', label: 'Reports', path: '/reports', collections: [], caps: ['reports:read'], navRoles: ['org_admin', 'manager_admin', 'accountant_admin'] },
  { key: 'timesheets', label: 'Timesheets', path: '/timesheets', collections: ['time_entries'], caps: ['time:write', 'timesheets:review'], navRoles: ['org_admin', 'manager_admin', 'accountant_admin'] },
  { key: 'team', label: 'Users', path: '/team', collections: [], caps: ['members:write'] },
  { key: 'audit', label: 'Activity', path: '/audit', collections: [], caps: ['audit:read'], navRoles: ['org_admin', 'manager_admin'] },
  { key: 'settings', label: 'Settings', path: '/settings', collections: ['service_offers'], caps: ['service:write', 'members:write', 'roles:write'], alwaysVisible: true },
];

// Optional modules a workspace can turn on/off (Super Admin → Features). When a
// feature is disabled it is enforced everywhere at once: its nav pages are
// hidden AND its data reads 403 (page stripped from the role's readPages) AND
// its write capabilities are stripped — so it behaves as if it never existed,
// while everything else keeps working. Enforcement is centralized in
// lib/auth.js → attachPerms (page/cap stripping) plus a requireFeature() gate on
// the handful of sub-feature action routes that own no page or capability.
//
// Shape of a flag:
//   key      — the flag stored under org.feature_flags.features[key]
//   label    — human label (Super Admin toggle + this list)
//   group    — UI grouping in the Super Admin Features tab
//   pages    — nav pages hidden + reads gated when off (optional)
//   caps     — write/action capabilities stripped when off (optional)
//   requires — prerequisite feature keys; if any is off, this feature is off too
//              (a customer-less workspace can't have work orders, and so on)
//
// Default is ON — a flag only takes effect when explicitly set to false.
export const FEATURE_FLAGS = [
  // --- Records: the foundational entities other modules hang off ---
  { key: 'customers', label: 'Customers, sites & equipment', group: 'Records', pages: ['customers'], caps: ['customers:write', 'sites:write', 'assets:write'] },
  { key: 'items', label: 'Inventory / parts & item costs', group: 'Records', pages: ['items'], caps: ['items:write', 'usage:write', 'items:create'] },
  // --- Field operations ---
  { key: 'work_orders', label: 'Work orders & job management', group: 'Field operations', pages: ['work_orders'], caps: ['work_orders:write', 'wo_lines:write', 'work_orders:tech_update', 'wo_lines:add_item'], requires: ['customers'] },
  { key: 'approval', label: 'Manager sign-off / approval', group: 'Field operations', caps: ['work_orders:approve'], requires: ['work_orders'] },
  { key: 'dispatch', label: 'Scheduling & dispatch board', group: 'Field operations', pages: ['dispatch', 'schedule'], caps: ['jobs:write'] },
  { key: 'projects', label: 'Projects & punch lists', group: 'Field operations', pages: ['projects'], caps: ['projects:write', 'punch:write'] },
  { key: 'time_tracking', label: 'Time tracking & timesheets', group: 'Field operations', pages: ['timesheets'], caps: ['time:write', 'timesheets:review'] },
  { key: 'tech_tracking', label: 'GPS technician tracking', group: 'Field operations', requires: ['time_tracking'] },
  { key: 'map', label: 'Live technician map', group: 'Field operations', pages: ['map'], requires: ['tech_tracking'] },
  { key: 'maintenance', label: 'Preventive maintenance', group: 'Field operations', pages: ['maintenance'], caps: ['maintenance:write'], requires: ['customers', 'work_orders'] },
  // --- Money ---
  { key: 'invoicing', label: 'Invoicing', group: 'Money', pages: ['invoices'], caps: ['invoices:write', 'invoice_lines:write'], requires: ['customers'] },
  { key: 'payments', label: 'Online / card payments', group: 'Money', requires: ['invoicing'] },
  // --- Customer experience ---
  { key: 'portal', label: 'Customer self-service portal', group: 'Customer experience', requires: ['customers'] },
  { key: 'tickets', label: 'Customer support ticketing', group: 'Customer experience', pages: ['tickets'], caps: ['tickets:write'], requires: ['customers'] },
  { key: 'sms', label: 'Automated “on the way” SMS & alerts', group: 'Customer experience', requires: ['work_orders'] },
  // --- Insights & administration ---
  { key: 'reports', label: 'Reporting & dashboards', group: 'Insights & admin', pages: ['reports'], caps: ['reports:read'] },
  { key: 'ai', label: 'Built-in AI assistant', group: 'Insights & admin', caps: ['ai:use'] },
  { key: 'custom_roles', label: 'Custom roles & permissions', group: 'Insights & admin', caps: ['roles:write'] },
  { key: 'regions', label: 'Regions / multi-location teams', group: 'Insights & admin', caps: ['regions:write', 'teams:write'] },
  { key: 'export', label: 'Full data export', group: 'Insights & admin' },
  { key: 'offline', label: 'Offline mode', group: 'Insights & admin' },
];

// Third-party integrations a workspace may use. Gating is enforced server-side
// (see /api/integrations/*) and reflected in the workspace's Settings.
export const INTEGRATION_FLAGS = [
  { key: 'intacct', label: 'Sage Intacct' },
];

const FEATURE_BY_KEY = Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, f]));
export const featureLabel = (key) => FEATURE_BY_KEY[key]?.label || key;
const featurePages = (f) => f.pages || (f.page ? [f.page] : []);

// A feature is EXPLICITLY enabled unless the workspace turned it off.
export const featureEnabled = (flags, key) => flags?.features?.[key] !== false;
// A feature is ACTIVE only if it's enabled AND every prerequisite is active.
// (So turning off "Customers" cascades: work orders, invoices, tickets… all go
// dark too, keeping the workspace in a coherent state.)
export function featureActive(flags, key) {
  if (!featureEnabled(flags, key)) return false;
  const f = FEATURE_BY_KEY[key];
  if (!f) return true;
  return (f.requires || []).every((r) => featureActive(flags, r));
}
// Page keys hidden by inactive features (client nav filter + server read-gate).
export const disabledFeaturePages = (flags) =>
  FEATURE_FLAGS.filter((f) => !featureActive(flags, f.key)).flatMap(featurePages);
// Write capabilities stripped by inactive features (server write-gate + client
// button hiding, since both key off the resolved capability set).
export const disabledFeatureCaps = (flags) =>
  FEATURE_FLAGS.filter((f) => !featureActive(flags, f.key)).flatMap((f) => f.caps || []);

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
