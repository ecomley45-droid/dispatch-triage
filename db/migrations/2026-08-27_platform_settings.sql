-- Migration: platform-wide settings (Super Admin) — 2026-08-27
-- Additive and idempotent. A tiny key/value store for platform-level config
-- like the Nexus Field favicon (key 'branding' -> { faviconUrl }).
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
