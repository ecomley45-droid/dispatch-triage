-- Migration: denormalize region onto work orders — 2026-08-21
-- Work orders carry their own region_id (stamped from the customer at creation)
-- so region-restricted members can be scoped to their region's work orders
-- without a per-row customer join. Backfills existing rows from the customer.
-- Additive and idempotent.

alter table work_orders add column if not exists region_id uuid references regions(id) on delete set null;

update work_orders wo
   set region_id = c.region_id
  from customers c
 where wo.customer_id = c.id
   and wo.region_id is null
   and c.region_id is not null;

create index if not exists idx_wo_region on work_orders(org_id, region_id);
