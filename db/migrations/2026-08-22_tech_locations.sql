-- Stores the most recent GPS fix for each clocked-in technician.
-- One row per (org, user) — upserted on every location ping from the client.
-- Cleared automatically on clock-out (handled server-side).
create table if not exists tech_locations (
  org_id      text             not null references orgs(id) on delete cascade,
  user_email  text             not null,
  lat         double precision not null,
  lon         double precision not null,
  accuracy    float,
  name        text,
  updated_at  timestamptz      not null default now(),
  primary key (org_id, user_email)
);
create index if not exists tech_locations_org on tech_locations(org_id);
