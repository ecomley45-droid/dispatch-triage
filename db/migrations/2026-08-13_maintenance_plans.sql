-- Migration: recurring / preventive maintenance plans — 2026-08-13
-- Additive and idempotent. A plan generates a work order each time it comes due,
-- then advances its next-due date by its frequency.

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

alter table maintenance_plans enable row level security;
alter table maintenance_plans force row level security;
