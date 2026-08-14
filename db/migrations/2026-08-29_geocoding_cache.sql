-- Migration: geocoding cache table — 2026-08-29
-- Additive and idempotent. Stores geocoded coordinates globally to reduce Nominatim requests.
create table if not exists geocoding_cache (
  address text primary key,
  lat double precision not null,
  lon double precision not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
