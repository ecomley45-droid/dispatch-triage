-- Per-workspace SSO/SAML settings — enterprise-tier only (see
-- lib/permissions.js ENTERPRISE_FLAGS). The actual SAML/OIDC handshake is
-- Clerk's own Enterprise Connections feature on the shared "Comley Nexus"
-- Clerk instance (already primary auth for this app in production, per
-- comley-nexus-ecosystem-migration-plan.md) — this table only remembers
-- what happens AFTER Clerk hands back a verified session: which role a
-- first-time SSO login should land in, and whether JIT provisioning is on
-- at all. One row per org; absence of a row means SSO is not configured for
-- that workspace.

create table if not exists sso_settings (
  org_id text primary key references orgs(id) on delete cascade,
  default_role text not null default 'technician',
  jit_provisioning_enabled boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Same posture as 2026-08-11_row_level_security.sql: enable + force RLS with
-- NO permissive policies. The server's service-role connection has
-- BYPASSRLS and is the only caller (see lib/store.js) — RLS here is a
-- backstop against a misdirected anon-key query, not the primary gate
-- (that's requireCapability('sso:write') + the enterprise-plan strip in
-- lib/auth.js attachPerms).
alter table sso_settings enable row level security;
alter table sso_settings force row level security;
