-- Migration: item_usage.work_order_id — 2026-09-01
-- Additive and idempotent. Techs log item usage against the work order
-- they're on, not a project — most field techs never worked with projects.
alter table item_usage add column if not exists work_order_id uuid references work_orders(id) on delete set null;
create index if not exists idx_item_usage_wo on item_usage(work_order_id);
