-- Migration: CRM spine + work orders (2026-08-08)
--
-- Additive and idempotent. Adds the customer → site → asset → work order model
-- and work-order line items. Same DDL as the block appended to db/schema.sql, so
-- a fresh install and an existing database converge.
--
-- Apply:
--   Supabase dashboard → SQL Editor → paste + Run, OR
--   SUPABASE_DB_URL=postgres://… psql -f db/migrations/2026-08-08_crm_work_orders.sql

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  billing_email text,
  phone text,
  billing_address text,
  payment_terms text default 'net_30',
  po_required boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
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
  name text not null,
  address text,
  access_notes text,
  contact_name text,
  contact_phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
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
  name text not null,
  category text,
  manufacturer text,
  model text,
  serial text,
  install_date date,
  warranty_expires date,
  status text not null default 'active' check (status in ('active', 'retired', 'needs_service')),
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
  number text,
  customer_id uuid references customers(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'requested'
    check (status in ('requested', 'scheduled', 'en_route', 'on_site', 'completed', 'invoiced', 'cancelled')),
  assignee_email text,
  requested_by text,
  sla_due timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  completed_at timestamptz,
  resolution_notes text,
  signature_url text,
  signature_name text,
  created_by text,
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
  kind text not null default 'labor' check (kind in ('labor', 'part', 'other')),
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_cost numeric(12,2) not null default 0,
  unit_price numeric(12,2) not null default 0,
  item_id uuid references items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_wo_lines_org on work_order_lines(org_id);
create index if not exists idx_wo_lines_wo on work_order_lines(work_order_id);
