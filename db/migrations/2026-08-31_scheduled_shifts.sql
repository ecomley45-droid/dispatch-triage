-- Migration: scheduled shifts (planned roster) — 2026-08-31
-- Additive and idempotent. A manager-set plan for a user's hours on a given
-- date — distinct from `shifts`, which records actual clock-in/out punches.
create table if not exists scheduled_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  date date not null,
  type text not null default 'shift', -- shift | pto | sick | call_out
  start_time text, -- 'HH:MM', shift type only
  end_time text,
  hours numeric,   -- planned hours for the day (any type)
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_email, date)
);
create index if not exists idx_sched_shifts_org_date on scheduled_shifts(org_id, date);
create index if not exists idx_sched_shifts_user on scheduled_shifts(org_id, user_email, date);

do $$
declare t text;
begin
  foreach t in array array['scheduled_shifts'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
