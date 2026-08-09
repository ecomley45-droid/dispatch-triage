-- Migration: custom per-workspace roles — 2026-08-16
-- Workspace Admins define roles with page / sub-feature / view-edit permissions.
-- The three built-in roles (manager_admin, accountant_admin, dispatcher) stay
-- virtual in code (lib/permissions.js PRESETS); only CUSTOM roles are stored.
-- org_members.role holds either a preset key or a custom role key.
-- Additive and idempotent.

create table if not exists roles (
  org_id text not null references orgs(id) on delete cascade,
  key text not null,                       -- slug, unique per workspace
  name text not null,
  permissions jsonb not null default '{}', -- { pages: [...], caps: [...] }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

create index if not exists idx_roles_org on roles(org_id);

-- org_members.role may now hold a custom role key, so drop the old CHECK that
-- limited it to the three presets (Postgres' default constraint name).
alter table org_members drop constraint if exists org_members_role_check;
