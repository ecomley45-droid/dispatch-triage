-- Migration: in-app notifications + per-user notification settings — 2026-08-18
-- Each member sees a bell with unread notifications. Sources (toggle per user):
--   * work order assigned to you
--   * incoming customer portal ticket message
-- Additive and idempotent.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,                 -- recipient
  type text not null,                        -- 'wo_assignment' | 'ticket_message' | ...
  title text not null,
  body text,
  link text,                                 -- in-app path, e.g. /work-orders/<id>
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_org on notifications(org_id);
create index if not exists idx_notif_user on notifications(org_id, user_email, created_at desc);

-- Per-user, per-workspace delivery preferences (jsonb of { type: bool }).
create table if not exists notification_prefs (
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, user_email)
);

do $$
declare t text;
begin
  foreach t in array array['notifications','notification_prefs'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
