-- Migration: customer ↔ workspace ticketing — 2026-08-17
-- A ticket is a threaded conversation between a customer (via the public portal
-- link, no login) and the workspace. It may reference a work order. Staff replies
-- can email the customer (see lib/email.js; the "from" is the workspace's own
-- configured sender). Additive and idempotent.

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  number text,                              -- human-friendly TK-0001 (per org)
  customer_id uuid references customers(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete set null,
  subject text not null,
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_email text,
  last_message_at timestamptz not null default now(),
  created_by text,                          -- staff email, or 'portal'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tickets_org on tickets(org_id);
create index if not exists idx_tickets_customer on tickets(customer_id);
create index if not exists idx_tickets_wo on tickets(work_order_id);
create index if not exists idx_tickets_org_last on tickets(org_id, last_message_at desc);

create table if not exists ticket_messages (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_type text not null default 'staff'
    check (author_type in ('staff', 'customer')),
  author_email text,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_msgs_org on ticket_messages(org_id);
create index if not exists idx_ticket_msgs_ticket on ticket_messages(ticket_id, created_at);

-- Seal the new tables under RLS (defense in depth; the service_role bypasses it).
do $$
declare t text;
begin
  foreach t in array array['tickets','ticket_messages'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;

-- The workspace's outbound email sender lives in orgs.feature_flags.email
-- ({ from, fromName, replyTo }); no schema change needed (feature_flags is jsonb).
