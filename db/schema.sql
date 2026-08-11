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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
create index if not exists idx_roles_org on roles(org_id);
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
  contact_name text,
  contact_phone text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
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
  created_by text,                          -- who opened/dispatched it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wo_org on work_orders(org_id);
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
    'tickets','ticket_messages','notifications','notification_prefs'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
