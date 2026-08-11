-- Migration: general-purpose notes field on sites — 2026-08-23
-- Additive and idempotent. Mirrors the existing customers.notes column so a
-- site can carry standing reference info (distinct from access_notes, which
-- is specifically gate codes/hours/parking) that's useful across every work
-- order, project, or ticket tied to that site.
alter table sites add column if not exists notes text;
