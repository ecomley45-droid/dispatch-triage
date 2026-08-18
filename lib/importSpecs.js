// Per-entity field specs for bulk import — the single source of truth shared
// by validation (lib/imports.js), the column-mapping UI, and the downloadable
// CSV templates (both server and browser build import this module, so keep it
// dependency-free like lib/permissions.js).
//
// Adding a new importable table = add one entry here + wire its target table
// name into lib/imports.js's TABLE_FIELDS allowlist (kept separate so a typo
// here can never widen what columns actually get written).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A field's `type` drives both coercion and validation in lib/imports.js:
//   string   — trimmed; empty string treated as null
//   email    — trimmed + lowercased; must match EMAIL_RE if present
//   number   — parsed with Number(); error if present but not finite
//   boolean  — accepts true/false/yes/no/1/0/y/n (case-insensitive)
//   date     — must parse via Date() if present (stored as the raw ISO-ish string)
//   enum     — must be one of `options` if present
//   lookup   — resolved against another entity's rows by external_id, then by
//              exact case-insensitive name, within the same org (see
//              resolveLookup in lib/imports.js). `lookupEntity` names which
//              spec/table to resolve against; must already exist — this app
//              doesn't support importing parents and children in one file, so
//              customers must be imported before sites, and sites before
//              assets with a site reference.

export const IMPORT_SPECS = {
  customers: {
    label: 'Customers',
    table: 'customers',
    // Tried in order: a row with an external_id upserts on that; otherwise,
    // if it has a billing_email, it upserts on that; otherwise it's a plain
    // insert (see chooseConflictTarget in lib/imports.js).
    conflictTargets: ['external_id', 'billing_email'],
    fields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'billing_email', label: 'Billing email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'string' },
      { key: 'billing_address', label: 'Billing address', type: 'string' },
      { key: 'payment_terms', label: 'Payment terms', type: 'enum', options: ['net_15', 'net_30', 'due_on_receipt'] },
      { key: 'po_required', label: 'PO required', type: 'boolean' },
      { key: 'status', label: 'Status', type: 'enum', options: ['active', 'inactive'] },
      { key: 'notes', label: 'Notes', type: 'string' },
      { key: 'external_id', label: 'External ID (your system\'s ID for this record)', type: 'string' },
    ],
  },

  sites: {
    label: 'Sites',
    table: 'sites',
    conflictTargets: ['external_id'],
    fields: [
      { key: 'customer_ref', label: 'Customer (external ID or exact name)', type: 'lookup', lookupEntity: 'customers', targetField: 'customer_id', required: true },
      { key: 'name', label: 'Site name', type: 'string', required: true },
      { key: 'address', label: 'Address', type: 'string' },
      { key: 'access_notes', label: 'Access notes', type: 'string' },
      { key: 'notes', label: 'Notes', type: 'string' },
      { key: 'contact_name', label: 'Contact name', type: 'string' },
      { key: 'contact_phone', label: 'Contact phone', type: 'string' },
      { key: 'status', label: 'Status', type: 'enum', options: ['active', 'inactive'] },
      { key: 'lat', label: 'Latitude', type: 'number' },
      { key: 'lon', label: 'Longitude', type: 'number' },
      { key: 'external_id', label: 'External ID', type: 'string' },
    ],
  },

  assets: {
    label: 'Assets',
    table: 'assets',
    conflictTargets: ['external_id'],
    fields: [
      { key: 'customer_ref', label: 'Customer (external ID or exact name)', type: 'lookup', lookupEntity: 'customers', targetField: 'customer_id', required: true },
      { key: 'site_ref', label: 'Site (external ID or exact name)', type: 'lookup', lookupEntity: 'sites', targetField: 'site_id' },
      { key: 'name', label: 'Asset name', type: 'string', required: true },
      { key: 'category', label: 'Category', type: 'string' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'string' },
      { key: 'model', label: 'Model', type: 'string' },
      { key: 'serial', label: 'Serial number', type: 'string' },
      { key: 'install_date', label: 'Install date', type: 'date' },
      { key: 'warranty_expires', label: 'Warranty expires', type: 'date' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'notes', label: 'Notes', type: 'string' },
      { key: 'external_id', label: 'External ID', type: 'string' },
    ],
  },

  items: {
    label: 'Items (parts/catalog)',
    table: 'items',
    conflictTargets: ['external_id', 'sku'],
    fields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
      { key: 'sku', label: 'SKU', type: 'string' },
      { key: 'unit', label: 'Unit (e.g. each, box)', type: 'string' },
      { key: 'unit_cost', label: 'Unit cost', type: 'number' },
      { key: 'external_id', label: 'External ID', type: 'string' },
    ],
  },

  // Members are a special case: promotion doesn't upsert into org_members
  // directly — it calls the same invite path as the Users page (Clerk
  // invitation email, role validation) so imported teammates onboard the
  // normal way. See commitMembers() in lib/imports.js. No import_job_id
  // tagging or rollback support for this entity — reverting an invite/role
  // grant isn't a safe blind delete once someone may have signed in.
  members: {
    label: 'Team members',
    table: 'org_members',
    special: 'members',
    conflictTargets: ['user_email'],
    fields: [
      { key: 'user_email', label: 'Email', type: 'email', required: true },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'role', label: 'Role (org_admin, manager_admin, accountant_admin, dispatcher, technician, or a custom role key)', type: 'string', required: true },
    ],
  },
};

export const IMPORT_ENTITY_KEYS = Object.keys(IMPORT_SPECS);

export function getSpec(entityType) {
  const spec = IMPORT_SPECS[entityType];
  if (!spec) throw Object.assign(new Error(`Unknown import entity type: ${entityType}`), { status: 400 });
  return spec;
}

// CSV header row a downloadable template uses — one column per field, in
// spec order, using each field's human label with the required ones starred.
export function templateHeaders(entityType) {
  return getSpec(entityType).fields.map((f) => (f.required ? `${f.label} *` : f.label));
}

export { EMAIL_RE };
