-- Migration: invoicing (2026-08-08)
--
-- Additive and idempotent. Adds invoices + invoice_lines. Same DDL as the block
-- appended to db/schema.sql.
--
-- Apply:
--   Supabase dashboard → SQL Editor → paste + Run, OR
--   SUPABASE_DB_URL=postgres://… psql -f db/migrations/2026-08-08_invoices.sql

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  number text,
  customer_id uuid references customers(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_invoices_org on invoices(org_id);
create index if not exists idx_invoices_customer on invoices(customer_id);
create index if not exists idx_invoices_wo on invoices(work_order_id);
create index if not exists idx_invoices_org_created on invoices(org_id, created_at desc);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_lines_org on invoice_lines(org_id);
create index if not exists idx_invoice_lines_invoice on invoice_lines(invoice_id);
