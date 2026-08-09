-- Migration: row-level security (defense in depth) — 2026-08-11
--
-- Enables RLS on every data table with NO permissive policies. Effect:
--   * The public/anon key (which ships in the browser bundle) and any
--     'authenticated' role can read/write NOTHING — the tables are sealed.
--   * The server's service_role connection has BYPASSRLS, so the app keeps
--     working exactly as before (it already injects org_id on every query).
--
-- This is a safety net: if the anon key is ever pointed at these tables, or a
-- future code path forgets to scope by org, the database itself refuses access.
-- Idempotent: enabling RLS on an already-enabled table is a no-op.
--
-- Client-side realtime presence uses the anon key but is channel-based (no
-- table reads), so it is unaffected.

do $$
declare t text;
begin
  foreach t in array array[
    'orgs','org_members','projects','punch_items','service_offers','jobs',
    'time_entries','items','item_usage','attachments','customers','sites',
    'assets','work_orders','work_order_lines','invoices','invoice_lines',
    'shifts','timesheet_requests'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('alter table public.%I force row level security;', t);
    end if;
  end loop;
end $$;
