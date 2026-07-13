-- GENERATED: db/schema.sql + db/seed.sql. Paste into Supabase SQL Editor and Run.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  name text,
  role text not null default 'dispatcher'
    check (role in ('manager_admin', 'accountant_admin', 'dispatcher')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (org_id, user_email)
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
  job_id uuid not null references jobs(id) on delete cascade,
  user_email text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_time_org on time_entries(org_id);
create index if not exists idx_time_job on time_entries(job_id);

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

-- Seed the first workspace + owner memberships. Idempotent (safe to re-run).
-- Run AFTER schema.sql.

insert into orgs (id, name, plan)
values ('family-dental', 'Family Dental Health', 'starter')
on conflict (id) do nothing;

insert into org_members (org_id, user_email, name, role)
values
  ('family-dental', 'bigefc45@me.com',        'Ethan Comley', 'manager_admin'),
  ('family-dental', 'ethanfcomley@gmail.com', 'Ethan Comley', 'manager_admin'),
  ('family-dental', 'ecomley45@gmail.com',    'Ethan Comley', 'manager_admin')
on conflict (org_id, user_email) do nothing;
