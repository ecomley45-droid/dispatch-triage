-- Public API keys + outbound webhooks (roadmap Phase 4b / enterprise
-- integration surface). See lib/apiKeys.js, lib/webhooks.js.

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  key_prefix text not null unique,
  key_hash text not null,
  caps jsonb not null default '[]'::jsonb,
  created_by_email text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_api_keys_org on api_keys(org_id);
create index if not exists idx_api_keys_prefix on api_keys(key_prefix);

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  url text not null,
  events jsonb not null default '[]'::jsonb,
  secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhooks_org on webhooks(org_id);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  attempt_count int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_webhook on webhook_deliveries(webhook_id);
-- Drives the retry cron: cheap "what's due" scan.
create index if not exists idx_webhook_deliveries_due on webhook_deliveries(next_attempt_at) where status = 'pending';

alter table api_keys enable row level security;
alter table api_keys force row level security;
alter table webhooks enable row level security;
alter table webhooks force row level security;
alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;
