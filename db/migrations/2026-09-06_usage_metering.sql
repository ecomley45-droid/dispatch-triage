-- Usage metering, rolled up per billing period. Field-local (Core stays
-- ecosystem metadata, not a warehouse — see item 6 of the enterprise plan);
-- Command reads current figures via GET /api/internal/usage-summary on
-- demand rather than a copy landing in Core's own database.

create table if not exists usage_period_summary (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  metric text not null,
  total numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, period_start, metric)
);
create index if not exists idx_usage_summary_org on usage_period_summary(org_id, period_start desc);

alter table usage_period_summary enable row level security;
alter table usage_period_summary force row level security;
