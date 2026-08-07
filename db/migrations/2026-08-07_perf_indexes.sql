-- Migration: performance indexes (2026-08-07)
--
-- Additive and idempotent. Safe to run on an existing production database; it
-- only CREATEs indexes that don't already exist. These are the same statements
-- appended to db/schema.sql so fresh installs get them too.
--
-- Why: Postgres does not auto-index foreign keys, and every list query filters
-- by org_id and sorts newest-first. Without these, list + pagination degrade to
-- a full-table scan + sort as each org's data grows.
--
-- Apply:
--   Supabase dashboard → SQL Editor → paste + Run, OR
--   SUPABASE_DB_URL=postgres://… psql -f db/migrations/2026-08-07_perf_indexes.sql
--
-- Note: on a large, live table prefer CREATE INDEX CONCURRENTLY (cannot run in a
-- transaction block) to avoid write locks. For this app's data volumes a plain
-- CREATE INDEX is fine.

-- Ordered-list + keyset-pagination coverage (matches store.list ORDER BY … DESC).
create index if not exists idx_projects_org_created      on projects(org_id, created_at desc);
create index if not exists idx_punch_org_created         on punch_items(org_id, created_at desc);
create index if not exists idx_jobs_org_created          on jobs(org_id, created_at desc);
create index if not exists idx_items_org_created         on items(org_id, created_at desc);
create index if not exists idx_time_org_created          on time_entries(org_id, created_at desc);
create index if not exists idx_item_usage_org_used       on item_usage(org_id, used_at desc);
create index if not exists idx_service_offers_org_created on service_offers(org_id, created_at desc);
create index if not exists idx_attachments_org_created   on attachments(org_id, created_at desc);

-- Unindexed foreign keys (FK lookups + ON DELETE cascade/set-null scans).
create index if not exists idx_jobs_service_offer        on jobs(service_offer_id);
create index if not exists idx_time_user                 on time_entries(user_email);
create index if not exists idx_item_usage_project        on item_usage(project_id);
create index if not exists idx_item_usage_job            on item_usage(job_id);

-- Columns used as list filters (server.js resource() `filters`).
create index if not exists idx_jobs_assignee             on jobs(assignee_email);
create index if not exists idx_punch_assignee            on punch_items(assignee_email);
