-- Platform-wide release notes / announcements — visible to every workspace,
-- so (unlike almost every other table in this schema) these are NOT
-- org-scoped. Authored/published by platform operators only (requirePlatformAdmin
-- in server.js), read by any authenticated user in any org. See lib/announcements.js
-- for the publish/scheduling/cache-version logic and src/super/pages/Announcements.jsx
-- for the console UI.

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,                      -- markdown; sanitized + rendered client-side (never trust stored HTML)
  type text not null default 'announcement'
    check (type in ('release_note', 'announcement', 'maintenance')),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published')),
  scheduled_at timestamptz,                 -- set when status = 'scheduled'; cron flips to published once due
  published_at timestamptz,                 -- set the moment it actually goes live (immediate publish or cron)
  version text,                             -- optional semver/build tag, release_note entries mainly
  force_cache_clear boolean not null default false, -- publish always clears clients' local response cache; this ALSO forces a hard reload
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Cron sweep: "everything due" (lib/announcements.js publishDueAnnouncements()).
create index if not exists idx_announcements_due on announcements(status, scheduled_at) where status = 'scheduled';
-- Help page changelog + the public "published" list, newest first.
create index if not exists idx_announcements_published on announcements(type, published_at desc) where status = 'published';

-- Per-user read/dismiss tracking so an announcement stops nagging once seen.
-- Keyed by email (this app has no separate users table — org_members and
-- every other per-user record use email as identity throughout).
create table if not exists user_announcement_reads (
  user_email text not null,
  announcement_id uuid not null references announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_email, announcement_id)
);
create index if not exists idx_announcement_reads_user on user_announcement_reads(user_email);

-- RLS: seal both (service_role, the only connection this app's server ever
-- uses, bypasses; anon/authenticated get nothing directly) — same as every
-- other table, see the sealing do-block at the end of db/schema.sql.
alter table announcements enable row level security;
alter table announcements force row level security;
alter table user_announcement_reads enable row level security;
alter table user_announcement_reads force row level security;

-- Global cache-version counter, reusing the existing platform_settings KV
-- table rather than a new system_config table (platform_settings already
-- exists for exactly this: platform-wide, non-org-scoped values). Seeded so
-- the very first client poll has something to compare against.
insert into platform_settings (key, value, updated_at)
values ('announcements_cache_version', '0'::jsonb, now())
on conflict (key) do nothing;
