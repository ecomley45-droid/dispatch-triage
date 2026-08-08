-- Migration: timesheet correction requests (2026-08-10)
-- Additive and idempotent. Dispatchers submit missed-punch corrections that a
-- manager approves; approval creates the shift record.

create table if not exists timesheet_requests (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  user_email text not null,
  target_date date,
  requested_clock_in timestamptz,
  requested_clock_out timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tsr_org on timesheet_requests(org_id);
create index if not exists idx_tsr_org_created on timesheet_requests(org_id, created_at desc);
create index if not exists idx_tsr_user on timesheet_requests(org_id, user_email);
