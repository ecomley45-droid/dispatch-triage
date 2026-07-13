# Dispatch — Handoff / Architecture

Scaffolded 2026-07-13. A field-service job-management platform, built to be sold or leased. First tenant: Family Dental Health. Stack ported from `comley-nexus`.

## What's built and verified

- **Runs with zero setup** — `npm install && npm run dev`. No DB/auth needed: in-memory demo store + dev-bypass viewer (Manager Admin on a seeded "Family Dental Health" org).
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

## Gotchas
- npm cache on this machine has root-owned files; if `npm install` hits EACCES, run with `--cache <writable dir>` or `sudo chown -R 501:20 ~/.npm`.
- In-memory store resets on restart — expected. Set Supabase env vars to persist.
- Dev bypass is always Manager Admin. To test other roles locally, wire Clerk and set `org_members.role`, or temporarily change the dev viewer's `role` in `lib/auth.js`.
