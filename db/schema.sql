-- Dispatch — full schema (idempotent). Run against a fresh Supabase/Postgres
-- project, or use db/migrations/* one at a time via `npm run db:apply`.
--
-- Multi-tenant: every content table carries org_id (text = URL slug) with an
-- FK to orgs(id). The server never accepts a client-provided org_id — it is
-- always injected from the authenticated viewer's org membership.

-- ---------- Tenancy ----------
create table if not exists orgs (
  id text primary key,                    -- URL slug, e.g. 'family-dental'
  name text not null,
  plan text not null default 'starter',
  feature_flags jsonb not null default '{}',
  branding jsonb not null default '{}',   -- { displayName, primaryColor, sidebarColor, logoUrl }
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  name text,
  -- role holds a preset key (manager_admin/accountant_admin/dispatcher) or a
  -- custom role key from the roles table; no CHECK so custom keys are allowed.
  role text not null default 'dispatcher',
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (org_id, user_email)
);

-- Custom per-workspace roles (built-in presets live in code, not here).
create table if not exists roles (
  org_id text not null references orgs(id) on delete cascade,
  key text not null,
  name text not null,
  permissions jsonb not null default '{}',  -- { pages: [...], caps: [...] }
  hidden boolean not null default false,    -- Org Admin hid this built-in role for the workspace
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
create index if not exists idx_roles_org on roles(org_id);

-- Platform-wide default permissions for built-in preset roles (Super Admin).
create table if not exists role_defaults (
  role_key text primary key,
  permissions jsonb not null default '{}',  -- { pages: [...], caps: [...] }
  updated_at timestamptz not null default now()
);

-- Platform-wide settings (Super Admin): key/value, e.g. 'branding' -> { faviconUrl }.
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists idx_org_members_email on org_members(user_email);

-- ---------- Projects (large project management) ----------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  client_name text,
  location text,
  status text not null default 'active'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'archived')),
  budget numeric(12,2),
  start_date date,
  due_date date,
  description text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_org on projects(org_id);

-- ---------- Punch sheet (task/deficiency list per project) ----------
create table if not exists punch_items (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_email text,
  photo_url text,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_punch_org on punch_items(org_id);
create index if not exists idx_punch_project on punch_items(project_id);

-- ---------- Service offers (catalog of services + default rate) ----------
create table if not exists service_offers (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  description text,
  unit text not null default 'hour',      -- hour, visit, flat
  default_rate numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_service_offers_org on service_offers(org_id);

-- ---------- Jobs (dispatch + time management: location, service, notes) ----------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  service_offer_id uuid references service_offers(id) on delete set null,
  title text not null,
  location text,
  status text not null default 'unscheduled'
    check (status in ('unscheduled', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  assignee_email text,                     -- the tech doing the work
  dispatcher_email text,                   -- who dispatched it
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_org on jobs(org_id);
create index if not exists idx_jobs_project on jobs(project_id);

-- ---------- Time entries (clock in/out against a job) ----------
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,          -- nullable: entry may attach to a work order instead
  work_order_id uuid references work_orders(id) on delete cascade,
  user_email text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_time_org on time_entries(org_id);
create index if not exists idx_time_job on time_entries(job_id);
create index if not exists idx_time_wo on time_entries(work_order_id);

-- Shift clock (start/end of a worker's day, not tied to a single job). Powers
-- the dashboard + schedule clock-in/out.
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_shifts_org on shifts(org_id);
create index if not exists idx_shifts_user on shifts(org_id, user_email);

-- Timesheet correction requests: a tech submits a missed-punch fix, a manager
-- approves (which creates the shift) or rejects.
create table if not exists timesheet_requests (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  target_date date,
  requested_clock_in timestamptz,
  requested_clock_out timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tsr_org on timesheet_requests(org_id);
create index if not exists idx_tsr_org_created on timesheet_requests(org_id, created_at desc);
create index if not exists idx_tsr_user on timesheet_requests(org_id, user_email);

-- ---------- Item cost tracker (item, image, cost per item, amount used) ----------
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  sku text,
  image_url text,
  unit text not null default 'each',
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_items_org on items(org_id);

create table if not exists item_usage (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  quantity numeric(12,2) not null default 1,
  -- unit_cost captured at time of use so historical cost survives price changes
  unit_cost_at_use numeric(12,2) not null default 0,
  used_at timestamptz not null default now(),
  recorded_by text,
  notes text
);
create index if not exists idx_item_usage_org on item_usage(org_id);
create index if not exists idx_item_usage_item on item_usage(item_id);

-- ---------- Attachments (photos/files on any entity) ----------
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  entity_type text not null,               -- 'project' | 'punch_item' | 'job' | 'item'
  entity_id uuid not null,
  url text not null,
  kind text not null default 'photo',      -- 'photo' | 'file'
  caption text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_entity on attachments(org_id, entity_type, entity_id);

-- ---------- Audit log (who changed what, when) ----------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_org_created on audit_log(org_id, created_at desc);
create index if not exists idx_audit_entity on audit_log(org_id, entity_type, entity_id);
create index if not exists idx_audit_actor on audit_log(org_id, actor_email);

-- ---------- CRM spine: customers → sites → assets → work orders ----------
-- The core of a multi-location field-service business. A customer (business
-- account) has many sites (physical locations); each site has assets (the
-- equipment we service); work orders are performed against a site/asset and
-- carry billable line items. org_id is always injected from the viewer.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  billing_email text,
  phone text,
  billing_address text,
  payment_terms text default 'net_30',     -- net_15, net_30, due_on_receipt, …
  po_required boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  portal_token uuid unique default gen_random_uuid(),   -- powers the public customer portal link
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_org on customers(org_id);
create index if not exists idx_customers_org_created on customers(org_id, created_at desc);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,                       -- e.g. 'North Clinic'
  address text,
  access_notes text,                        -- gate codes, hours, where to park
  notes text,                               -- general reference notes, shared across every WO/project/ticket at this site
  contact_name text,
  contact_phone text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  lat double precision,                     -- stored coordinates, so the Map page skips runtime geocoding
  lon double precision,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sites_org on sites(org_id);
create index if not exists idx_sites_customer on sites(customer_id);
create index if not exists idx_sites_org_created on sites(org_id, created_at desc);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  name text not null,                       -- e.g. 'Operatory Chair #3'
  category text,                            -- HVAC, dental_chair, compressor, …
  manufacturer text,
  model text,
  serial text,
  install_date date,
  warranty_expires date,
  status text not null default 'active'
    check (status in ('active', 'retired', 'needs_service')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assets_org on assets(org_id);
create index if not exists idx_assets_customer on assets(customer_id);
create index if not exists idx_assets_site on assets(site_id);
create index if not exists idx_assets_org_created on assets(org_id, created_at desc);

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  number text,                              -- human-friendly WO-0001 (per org)
  customer_id uuid references customers(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'requested'
    check (status in ('requested', 'scheduled', 'en_route', 'on_site', 'completed', 'invoiced', 'cancelled')),
  assignee_email text,                      -- the tech assigned
  requested_by text,                        -- customer contact who called it in
  sla_due timestamptz,                      -- response/resolution deadline
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  completed_at timestamptz,
  resolution_notes text,
  signature_url text,                       -- customer sign-off image
  signature_name text,                      -- printed name of signer
  approved_at timestamptz,                  -- manager sign-off; a job isn't truly done until set
  approved_by text,
  region_id uuid,                           -- denormalized from the customer (see migrations); FK added post-regions
  created_by text,                          -- who opened/dispatched it
  sla_alerted_at timestamptz,               -- set once the daily cron has flagged this WO overdue (dedup)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wo_org on work_orders(org_id);
create index if not exists idx_wo_region on work_orders(org_id, region_id);
create index if not exists idx_wo_customer on work_orders(customer_id);
create index if not exists idx_wo_site on work_orders(site_id);
create index if not exists idx_wo_asset on work_orders(asset_id);
create index if not exists idx_wo_assignee on work_orders(assignee_email);
create index if not exists idx_wo_org_created on work_orders(org_id, created_at desc);

create table if not exists work_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  kind text not null default 'labor'
    check (kind in ('labor', 'part', 'other')),
  description text not null,
  quantity numeric(12,2) not null default 1,   -- hours for labor, count for parts
  unit_cost numeric(12,2) not null default 0,  -- our cost
  unit_price numeric(12,2) not null default 0, -- what we bill the customer
  item_id uuid references items(id) on delete set null,  -- link a part to inventory
  created_at timestamptz not null default now()
);
create index if not exists idx_wo_lines_org on work_order_lines(org_id);
create index if not exists idx_wo_lines_wo on work_order_lines(work_order_id);

-- ---------- Invoicing (the money loop) ----------
-- An invoice is a point-in-time billable record. Its lines are SNAPSHOTTED from
-- the work order at generation time so later edits to the work order never
-- mutate an already-issued invoice. Totals are denormalized on the invoice so
-- the list view needs no per-row line fetch.

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  number text,                              -- INV-0001 (per org)
  customer_id uuid references customers(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,     -- percent, e.g. 8.250
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  created_by text,
  overdue_alerted_at timestamptz,           -- set once the daily cron has flagged this invoice overdue (dedup)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_invoices_org on invoices(org_id);
create index if not exists idx_invoices_customer on invoices(customer_id);
create index if not exists idx_invoices_wo on invoices(work_order_id);
create index if not exists idx_invoices_org_created on invoices(org_id, created_at desc);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,      -- quantity * unit_price, frozen
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_lines_org on invoice_lines(org_id);
create index if not exists idx_invoice_lines_invoice on invoice_lines(invoice_id);

-- ---------- Recurring / preventive maintenance ----------
create table if not exists maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  frequency text not null default 'quarterly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  assignee_email text,
  next_due date,
  last_generated date,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mplans_org on maintenance_plans(org_id);
create index if not exists idx_mplans_org_created on maintenance_plans(org_id, created_at desc);
create index if not exists idx_mplans_due on maintenance_plans(org_id, next_due);

-- ---------- Customer ticketing (threaded portal ↔ workspace messaging) ----------
create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  number text,
  customer_id uuid references customers(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete set null,
  subject text not null,
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_email text,
  last_message_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tickets_org on tickets(org_id);
create index if not exists idx_tickets_customer on tickets(customer_id);
create index if not exists idx_tickets_wo on tickets(work_order_id);
create index if not exists idx_tickets_org_last on tickets(org_id, last_message_at desc);

create table if not exists ticket_messages (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_type text not null default 'staff'
    check (author_type in ('staff', 'customer')),
  author_email text,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_msgs_org on ticket_messages(org_id);
create index if not exists idx_ticket_msgs_ticket on ticket_messages(ticket_id, created_at);

-- ---------- In-app notifications + per-user delivery preferences ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_org on notifications(org_id);
create index if not exists idx_notif_user on notifications(org_id, user_email, created_at desc);

create table if not exists notification_prefs (
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, user_email)
);

-- ---------- Per-workspace third-party integrations (encrypted secrets) ----------
create table if not exists integrations (
  org_id text not null references orgs(id) on delete cascade,
  provider text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
create index if not exists idx_integrations_org on integrations(org_id);

-- ---------- Regions + Teams (org structure) ----------
create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_regions_org on regions(org_id);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  region_id uuid references regions(id) on delete set null,
  name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_teams_org on teams(org_id);
create index if not exists idx_teams_region on teams(region_id);

-- ---------- Geocoding cache table ----------
create table if not exists geocoding_cache (
  address text primary key,
  lat double precision not null,
  lon double precision not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Region/Team assignment columns on existing tables (idempotent).
alter table customers    add column if not exists region_id uuid references regions(id) on delete set null;
alter table org_members  add column if not exists region_id uuid references regions(id) on delete set null;
alter table org_members  add column if not exists team_id uuid references teams(id) on delete set null;
alter table roles        add column if not exists default_region_id uuid references regions(id) on delete set null;
create index if not exists idx_customers_region on customers(region_id);
create index if not exists idx_members_team on org_members(team_id);

-- Presence heartbeat (polled "who's online", replaces Supabase Realtime which
-- caps connections per channel — too low for large workspaces).
alter table org_members  add column if not exists last_seen_at timestamptz;
create index if not exists idx_members_last_seen on org_members(org_id, last_seen_at desc);

-- Scheduled shifts (planned roster) — a manager-set plan for a user's hours on
-- a given date. Distinct from `shifts`, which records actual clock-in/out.
create table if not exists scheduled_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  date date not null,
  type text not null default 'shift', -- shift | pto | sick | call_out
  start_time text,
  end_time text,
  hours numeric,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_email, date)
);
create index if not exists idx_sched_shifts_org_date on scheduled_shifts(org_id, date);
create index if not exists idx_sched_shifts_user on scheduled_shifts(org_id, user_email, date);

-- Techs log item usage against the work order they're on, not a project.
alter table item_usage add column if not exists work_order_id uuid references work_orders(id) on delete set null;
create index if not exists idx_item_usage_wo on item_usage(work_order_id);

-- ---------- Bulk client-onboarding data import ----------
-- See db/migrations/2026-09-02_bulk_import.sql for full rationale. Staging-
-- table pattern: uploaded rows land in import_staging_rows first, get
-- validated, then only valid rows are upserted into the live table.
create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  entity_type text not null,
  status text not null default 'staged'
    check (status in ('staged', 'validated', 'committing', 'committed', 'failed', 'rolled_back')),
  source_filename text,
  column_mapping jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by text
);
create index if not exists idx_import_jobs_org_created on import_jobs(org_id, created_at desc);

create table if not exists import_staging_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  org_id text not null references orgs(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  normalized jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'error')),
  match_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_import_staging_job on import_staging_rows(import_job_id, row_number);
create index if not exists idx_import_staging_org  on import_staging_rows(org_id, import_job_id);

create table if not exists import_job_errors (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  org_id text not null references orgs(id) on delete cascade,
  row_number integer not null,
  field text,
  message text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_import_errors_job on import_job_errors(import_job_id, row_number);

alter table customers add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table sites      add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table assets     add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table items      add column if not exists import_job_id uuid references import_jobs(id) on delete set null;

alter table customers add column if not exists external_id text;
alter table sites      add column if not exists external_id text;
alter table assets     add column if not exists external_id text;
alter table items      add column if not exists external_id text;

create unique index if not exists uq_customers_org_external on customers(org_id, external_id) where external_id is not null;
create unique index if not exists uq_sites_org_external      on sites(org_id, external_id)      where external_id is not null;
create unique index if not exists uq_assets_org_external     on assets(org_id, external_id)      where external_id is not null;
create unique index if not exists uq_items_org_external      on items(org_id, external_id)       where external_id is not null;
create unique index if not exists uq_customers_org_billing_email on customers(org_id, billing_email) where billing_email is not null and billing_email <> '';
create unique index if not exists uq_items_org_sku on items(org_id, sku) where sku is not null and sku <> '';

-- ---------- Platform-wide announcements / release notes ----------
-- See db/migrations/2026-09-03_announcements.sql for full rationale. Not
-- org-scoped (unlike almost everything else in this schema) — visible to
-- every workspace.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  type text not null default 'announcement'
    check (type in ('release_note', 'announcement', 'maintenance')),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  version text,
  force_cache_clear boolean not null default false,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_announcements_due on announcements(status, scheduled_at) where status = 'scheduled';
create index if not exists idx_announcements_published on announcements(type, published_at desc) where status = 'published';

create table if not exists user_announcement_reads (
  user_email text not null,
  announcement_id uuid not null references announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_email, announcement_id)
);
create index if not exists idx_announcement_reads_user on user_announcement_reads(user_email);

insert into platform_settings (key, value, updated_at)
values ('announcements_cache_version', '0'::jsonb, now())
on conflict (key) do nothing;

-- ---------- Performance indexes ----------
-- Postgres does NOT auto-index foreign keys, and every list query in this app
-- filters by org_id and sorts newest-first. These composite (org_id, sort_col)
-- indexes let the list + pagination cursor be served straight from the index;
-- the remaining single-column indexes cover unindexed FKs and query filters.
-- Kept together here (idempotent) and mirrored in db/migrations/ for existing DBs.

-- Ordered-list + keyset-pagination coverage (matches store.list ORDER BY … DESC).
create index if not exists idx_projects_org_created    on projects(org_id, created_at desc);
create index if not exists idx_punch_org_created       on punch_items(org_id, created_at desc);
create index if not exists idx_jobs_org_created        on jobs(org_id, created_at desc);
create index if not exists idx_items_org_created       on items(org_id, created_at desc);
create index if not exists idx_time_org_created        on time_entries(org_id, created_at desc);
create index if not exists idx_item_usage_org_used     on item_usage(org_id, used_at desc);
create index if not exists idx_service_offers_org_created on service_offers(org_id, created_at desc);
create index if not exists idx_attachments_org_created on attachments(org_id, created_at desc);

-- Unindexed foreign keys (FK lookups + ON DELETE cascade/set-null scans).
create index if not exists idx_jobs_service_offer      on jobs(service_offer_id);
create index if not exists idx_time_user              on time_entries(user_email);
create index if not exists idx_item_usage_project      on item_usage(project_id);
create index if not exists idx_item_usage_job          on item_usage(job_id);

-- Columns used as list filters (server.js resource() `filters`).
create index if not exists idx_jobs_assignee           on jobs(assignee_email);
create index if not exists idx_punch_assignee          on punch_items(assignee_email);

-- ---------- Row-level security (defense in depth) ----------
-- Seal every data table: the public/anon key and the 'authenticated' role can
-- read/write nothing. The server's service_role connection has BYPASSRLS and is
-- unaffected. See db/migrations/2026-08-11_row_level_security.sql for rationale.
do $$
declare t text;
begin
  foreach t in array array[
    'orgs','org_members','projects','punch_items','service_offers','jobs',
    'time_entries','items','item_usage','attachments','customers','sites',
    'assets','work_orders','work_order_lines','invoices','invoice_lines',
    'shifts','timesheet_requests','audit_log','maintenance_plans',
    'tickets','ticket_messages','notifications','notification_prefs','integrations',
    'regions','teams','geocoding_cache','scheduled_shifts',
    'import_jobs','import_staging_rows','import_job_errors',
    'announcements','user_announcement_reads'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
