-- Migration: shift clock, work-order time tracking, manager approval (2026-08-09)
--
-- Additive and idempotent. Apply in Supabase SQL Editor (or via psql).

-- time_entries can now attach to a work order (job_id becomes optional).
alter table time_entries add column if not exists work_order_id uuid references work_orders(id) on delete cascade;
alter table time_entries alter column job_id drop not null;
create index if not exists idx_time_wo on time_entries(work_order_id);

-- Manager sign-off on a work order. approved_at null = tech-completed but not yet approved.
alter table work_orders add column if not exists approved_at timestamptz;
alter table work_orders add column if not exists approved_by text;

-- Shift clock (start/end of a worker's day).
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_shifts_org on shifts(org_id);
create index if not exists idx_shifts_user on shifts(org_id, user_email);
