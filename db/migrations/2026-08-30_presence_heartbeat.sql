-- Migration: presence heartbeat — 2026-08-30
-- Additive and idempotent. Replaces Supabase Realtime presence (which caps at
-- 200 connections/channel, 500 total on Pro — too low for large workspaces)
-- with a polled last_seen_at column on org_members.
alter table org_members add column if not exists last_seen_at timestamptz;
create index if not exists idx_members_last_seen on org_members(org_id, last_seen_at desc);
