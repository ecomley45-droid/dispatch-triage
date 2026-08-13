-- Migration: stored site coordinates — 2026-08-28
-- Additive and idempotent. The Map page runtime-geocodes a site's address via
-- Nominatim/Azure in the browser, which can miss or get rate-limited for some
-- addresses. Optional lat/lon columns let a site's location be set once
-- (at creation or backfilled) so the map can place its pin directly.
alter table sites add column if not exists lat double precision;
alter table sites add column if not exists lon double precision;
