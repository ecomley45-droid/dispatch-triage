-- Seed the first workspace + owner memberships. Idempotent (safe to re-run).
-- Run AFTER schema.sql.

insert into orgs (id, name, plan)
values ('family-dental', 'Family Dental Health', 'starter')
on conflict (id) do nothing;

insert into org_members (org_id, user_email, name, role)
values
  ('family-dental', 'bigefc45@me.com',        'Ethan Comley', 'manager_admin'),
  ('family-dental', 'ethanfcomley@gmail.com', 'Ethan Comley', 'manager_admin'),
  ('family-dental', 'ecomley45@gmail.com',    'Ethan Comley', 'manager_admin')
on conflict (org_id, user_email) do nothing;
