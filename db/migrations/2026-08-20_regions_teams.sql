-- Migration: Regions + Teams (org structure) — 2026-08-20
-- Regions group customers/work; Teams are a subsection of a Region that members
-- belong to. Managers create/edit both. Technicians only ever see their own data
-- (enforced in the app layer). Additive and idempotent.

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

-- Customers belong to a region; members belong to a region + team; roles can
-- carry a default region for auto-assignment of new members.
alter table customers    add column if not exists region_id uuid references regions(id) on delete set null;
alter table org_members  add column if not exists region_id uuid references regions(id) on delete set null;
alter table org_members  add column if not exists team_id uuid references teams(id) on delete set null;
alter table roles        add column if not exists default_region_id uuid references regions(id) on delete set null;
create index if not exists idx_customers_region on customers(region_id);
create index if not exists idx_members_team on org_members(team_id);

do $$
declare t text;
begin
  foreach t in array array['regions','teams'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
