-- Migration: customer portal access token — 2026-08-14
-- Each customer gets an unguessable token that powers a public, link-based
-- portal (no login). Additive and idempotent.

alter table customers add column if not exists portal_token uuid;
update customers set portal_token = gen_random_uuid() where portal_token is null;
alter table customers alter column portal_token set default gen_random_uuid();
create unique index if not exists idx_customers_portal_token on customers(portal_token);
