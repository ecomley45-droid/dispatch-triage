-- Migration: platform super-admin — per-workspace branding + billing — 2026-08-15
-- Adds columns the Nexus Super Admin console manages on each client workspace:
--   branding: { displayName, primaryColor, sidebarColor, logoUrl } applied on
--             that workspace's client site.
--   Stripe subscription tracking for platform billing.
-- All additive and idempotent.

alter table orgs add column if not exists branding jsonb not null default '{}';
alter table orgs add column if not exists stripe_customer_id text;
alter table orgs add column if not exists stripe_subscription_id text;
alter table orgs add column if not exists subscription_status text;
alter table orgs add column if not exists billing_email text;
