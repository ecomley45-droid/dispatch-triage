# Dispatch — Handoff / Architecture

Scaffolded 2026-07-13. Nexus Field: a general field-service job-management platform, built to be sold or leased. Family Dental Health is a prospective client (pitch/demo use), not the product identity. Stack ported from `comley-nexus`.

## What's built and verified

- **Runs with zero setup** — `npm install && npm run dev`. No DB/auth needed: in-memory demo store + dev-bypass viewer (Org Admin on a seeded neutral "demo" org).
- **Multi-tenant, capability-gated API** — `org_id` is always injected server-side from the authenticated viewer; a client-supplied `org_id` is ignored (verified).
- **Full UI** — Dashboard, Projects, Project detail + Punch sheet, Dispatch & Time, Items & Costs, Team. Role-aware (write buttons hidden without the capability).
- `npm run build` passes; API boots and serves all endpoints.

## Architecture

```
index.html ─ vite ─▶ src/main.jsx ─▶ (ClerkProvider?) ─▶ MeProvider ─▶ App (router)
                                                                        │
src/lib/api.js  ── fetch /api/* ──────────────────────────────────────┘
        │
server.js (Express)
  ├─ lib/auth.js    resolveViewer → req.viewer + req.org; requireCapability(cap)
  ├─ lib/store.js   org-scoped data layer; Supabase OR in-memory (auto)
  └─ lib/db.js      Supabase client singleton (null ⇒ in-memory)
db/schema.sql       full Postgres schema
```

### Data model (db/schema.sql)
`orgs`, `org_members` (role: manager_admin | accountant_admin | dispatcher), `projects`, `punch_items`, `service_offers`, `jobs`, `time_entries`, `items`, `item_usage`, `attachments`.

### Permissions (lib/auth.js → CAPABILITIES)
One map of `capability → [roles]`. Reads are open to any member; writes are gated. Change access by editing that map — both the server (`requireCapability`) and the UI (`me.can(...)`) read from it via `/api/me`.

## Spec → implementation

| Spec | Where |
|------|-------|
| Large project management | `projects` + Projects/ProjectDetail pages |
| Punch sheet | `punch_items` + ProjectDetail (add + click-to-advance status) |
| Time management (location, service offers, notes) | `jobs` + `service_offers` + `time_entries`; Dispatch page |
| Photos & notes | `notes` fields today; `attachments` table + upload = next step |
| Item cost tracker (item, image, cost, amount used) | `items` + `item_usage`; Items page (per-item + total cost) |
| User types | `org_members.role` + capability map; Team page |

## Next steps (backlog, roughly ordered)

1. **Photo/file upload** — wire `attachments` to Supabase Storage (+ `sharp` resize, as in comley-nexus). Add to punch items, jobs, items.
2. **Time tracking UI** — clock in/out against a job writes `time_entries`; timesheet/report view (Accountant Admin).
3. **Team invites** — `POST /api/members` + email invite (Clerk). Stub is in Team.jsx.
4. **Billing** — port Stripe from comley-nexus for the lease/subscription model.
5. **Costing rollup** — project P&L: budget vs. logged material cost + labor hours × service rate.
6. **Edit/delete UI** — factory API already supports PATCH/DELETE; pages only wire create + status today.
7. **Mobile** — the API is a clean REST surface; a React Native / Expo client can reuse it directly for the field app.
8. **Harden for prod** — turn CSP back on in `server.js` (helmet), add rate limiting, Sentry (patterns in comley-nexus).

*(Items 1–8 above are stale as of the multi-tenant refactor pass on 2026-08-17 — most have since shipped: attachments/uploads, time tracking, team invites, billing scaffolding, CSP/rate-limiting/Sentry are all in. Left as-is rather than rewritten, since this list wasn't the ask; see the dated section below for what's actually still open.)*

## Deferred — multi-tenant / theming refactor (2026-08-17)

Not immediate needs; flagged during the audit-first multi-tenant refactor pass (branding self-service, neutral default theme/logo, neutral zero-setup demo data all shipped that session — see git log around this date). Two items were explicitly scoped out as non-urgent:

1. **Copy/content i18n-style dictionary** — move user-facing strings into a config or i18n-style dictionary keyed by tenant, so onboarding a new client needs zero component-code changes. The audit at the time found hardcoded copy was already minimal (mostly stale docs/README mentions of Family Dental Health, not component-level strings) — worth a proper pass once there are 2+ real clients with genuinely different terminology needs, not before.
2. **Neutral demo-tenant seeding, exposed as a real flow** — today there's the zero-setup in-memory demo (neutral, `lib/store.js`) and two Supabase-backed seed paths, both dental-flavored on purpose (`lib/demo.js` via Super Admin's per-workspace "Demo seed" action, and `scripts/seed-demo.mjs` for the real FDH pitch). There's no *generic* Supabase-backed demo-tenant seed a salesperson could spin up for a non-dental prospect without touching dental fixtures. Add a neutral profile alongside `lib/demo.js` (e.g. `industry: 'dental' | 'generic'` param) once there's a second vertical actually being pitched.

## Gotchas
- npm cache on this machine has root-owned files; if `npm install` hits EACCES, run with `--cache <writable dir>` or `sudo chown -R 501:20 ~/.npm`.
- In-memory store resets on restart — expected. Set Supabase env vars to persist.
- Dev bypass is always Manager Admin. To test other roles locally, wire Clerk and set `org_members.role`, or temporarily change the dev viewer's `role` in `lib/auth.js`.
