-- Migration: one-shot alert stamps for the daily notification cron — 2026-08-24
-- Additive and idempotent. The daily cron (/api/cron/daily) notifies once when a
-- work order passes its SLA or an invoice goes overdue; these nullable stamps
-- record that a notice already went out so a later run doesn't re-notify.
alter table work_orders add column if not exists sla_alerted_at timestamptz;
alter table invoices    add column if not exists overdue_alerted_at timestamptz;
