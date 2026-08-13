-- Migration: role management — platform preset defaults + workspace overrides — 2026-08-26
-- Additive and idempotent.
--
-- role_defaults: a Super-Admin-set, platform-wide default permission set for a
-- built-in preset role (applies to every workspace unless the workspace itself
-- overrides it). Global, not org-scoped.
create table if not exists role_defaults (
  role_key text primary key,
  permissions jsonb not null default '{}'::jsonb,   -- { pages: [...], caps: [...] }
  updated_at timestamptz not null default now()
);

-- roles.hidden: an Org Admin can hide a built-in role their workspace doesn't
-- use (it disappears from the assignment pickers). The preset's page override,
-- when set, rides in the existing permissions jsonb as { pages: [...] }.
alter table roles add column if not exists hidden boolean not null default false;
