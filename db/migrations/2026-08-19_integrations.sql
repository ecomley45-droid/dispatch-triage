-- Migration: per-workspace third-party integrations (e.g. Sage Intacct) — 2026-08-19
-- Each workspace configures its OWN integration credentials. Secret fields are
-- stored ENCRYPTED (lib/crypto.js, AES-256-GCM via SECRETS_KEY) inside config —
-- never in orgs.feature_flags (which is sent to the browser). Whether a
-- workspace is ALLOWED to use an integration is a separate flag the Super Admin
-- sets in orgs.feature_flags.integrations. Additive and idempotent.

create table if not exists integrations (
  org_id text not null references orgs(id) on delete cascade,
  provider text not null,                    -- 'intacct' | ...
  enabled boolean not null default false,    -- workspace has switched it on
  config jsonb not null default '{}',         -- non-secret fields + encrypted secrets
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
create index if not exists idx_integrations_org on integrations(org_id);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='integrations') then
    execute 'alter table public.integrations enable row level security';
    execute 'alter table public.integrations force row level security';
  end if;
end $$;
