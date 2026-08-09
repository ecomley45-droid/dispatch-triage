-- Migration: audit log — 2026-08-12
--
-- Records who changed what, when. Every create/update/delete and privileged
-- action (approvals, payments, invoicing, member + role changes, timesheet
-- reviews) writes a row here. Read access is manager-only (enforced in the API).
-- Additive and idempotent.

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  actor_email text,                         -- who did it (from the verified session)
  action text not null,                     -- create | update | delete | approve | pay | invoice | member | review | login
  entity_type text not null,                -- e.g. work_orders, invoices, org_members
  entity_id text,                           -- the affected record's id
  summary text,                             -- short human-readable description
  details jsonb not null default '{}',      -- extra structured context
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_org_created on audit_log(org_id, created_at desc);
create index if not exists idx_audit_entity on audit_log(org_id, entity_type, entity_id);
create index if not exists idx_audit_actor on audit_log(org_id, actor_email);

-- Seal it like the rest (service_role bypasses; anon/authenticated get nothing).
alter table audit_log enable row level security;
alter table audit_log force row level security;
