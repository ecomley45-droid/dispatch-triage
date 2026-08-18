-- Bulk client-onboarding data import (customers, sites, assets, items,
-- members). Staging-table pattern: raw upload rows land in
-- import_staging_rows first; validation runs against staged rows; only
-- validated rows get promoted (upserted) into the live tables. Every
-- promoted/updated row is tagged with import_job_id so a bad import can be
-- reverted with one query. See lib/imports.js for the validate/commit/
-- rollback logic and lib/importSpecs.js for the per-entity field specs.

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  entity_type text not null,               -- 'customers' | 'sites' | 'assets' | 'items' | 'members'
  status text not null default 'staged'
    check (status in ('staged', 'validated', 'committing', 'committed', 'failed', 'rolled_back')),
  source_filename text,
  column_mapping jsonb not null default '{}'::jsonb,  -- { sourceHeader: targetField }
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  created_by text not null,                -- viewer email who ran the import
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by text
);
create index if not exists idx_import_jobs_org_created on import_jobs(org_id, created_at desc);

-- Raw + normalized row data per job, before promotion. One row per uploaded
-- spreadsheet row. Never written to a live table directly from the upload —
-- validation and promotion both read from here.
create table if not exists import_staging_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  org_id text not null references orgs(id) on delete cascade,
  row_number integer not null,             -- 1-based, matches the source spreadsheet row (for error messages)
  raw jsonb not null,                      -- original row as uploaded, keyed by source column header
  normalized jsonb,                        -- after column mapping + type coercion; null until validated
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'error')),
  match_id uuid,                           -- existing live-table row id this will UPDATE, if matched by dedupe key; null = INSERT
  created_at timestamptz not null default now()
);
create index if not exists idx_import_staging_job on import_staging_rows(import_job_id, row_number);
create index if not exists idx_import_staging_org  on import_staging_rows(org_id, import_job_id);

-- Per-row validation failures, for the preview screen and post-mortem
-- troubleshooting. A row can have more than one error (e.g. missing name AND
-- bad email), so this is a child table rather than a column on the row.
create table if not exists import_job_errors (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  org_id text not null references orgs(id) on delete cascade,
  row_number integer not null,
  field text,                              -- target field the error is about, if applicable
  message text not null,
  raw jsonb,                               -- the offending row, for troubleshooting without re-joining staging
  created_at timestamptz not null default now()
);
create index if not exists idx_import_errors_job on import_job_errors(import_job_id, row_number);

-- Rollback support: tag every row an import job created or updated. Nullable
-- and additive — existing hand-entered rows are untouched (null). A rollback
-- only ever deletes rows this job *inserted* (import_job_id set AND the row
-- didn't exist before); rows it *updated* are flagged for manual review
-- instead of being blindly overwritten, since a later legitimate edit to that
-- row would otherwise be silently destroyed. See lib/imports.js rollbackJob().
alter table customers add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table sites      add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table assets     add column if not exists import_job_id uuid references import_jobs(id) on delete set null;
alter table items      add column if not exists import_job_id uuid references import_jobs(id) on delete set null;

-- external_id: the client's own system's ID for this record (from whatever
-- they're migrating off of). This is the primary upsert conflict target, so
-- re-running an import with the same source file updates existing rows
-- instead of duplicating them. Most existing/manually-created rows won't have
-- one, hence a partial unique index rather than a plain NOT NULL unique.
alter table customers add column if not exists external_id text;
alter table sites      add column if not exists external_id text;
alter table assets     add column if not exists external_id text;
alter table items      add column if not exists external_id text;

create unique index if not exists uq_customers_org_external on customers(org_id, external_id) where external_id is not null;
create unique index if not exists uq_sites_org_external      on sites(org_id, external_id)      where external_id is not null;
create unique index if not exists uq_assets_org_external     on assets(org_id, external_id)      where external_id is not null;
create unique index if not exists uq_items_org_external      on items(org_id, external_id)       where external_id is not null;

-- Secondary dedupe keys for rows with no external_id: customers by billing
-- email, items by SKU — both already meaningful natural identifiers in this
-- schema. Sites/assets have no reliable natural key (a site name isn't
-- unique across a client's whole book), so those dedupe on external_id only;
-- with no external_id, every imported site/asset row is treated as new.
create unique index if not exists uq_customers_org_billing_email on customers(org_id, billing_email) where billing_email is not null and billing_email <> '';
create unique index if not exists uq_items_org_sku on items(org_id, sku) where sku is not null and sku <> '';

-- RLS: seal the three new tables the same way as every other data table (see
-- the sealing do-block at the end of db/schema.sql) — service_role (the only
-- connection this app's server ever uses) bypasses RLS; anon/authenticated
-- get nothing directly.
alter table import_jobs enable row level security;
alter table import_jobs force row level security;
alter table import_staging_rows enable row level security;
alter table import_staging_rows force row level security;
alter table import_job_errors enable row level security;
alter table import_job_errors force row level security;
