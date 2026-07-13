# Dispatch — Field Service Management

A multi-tenant field-service / job-management platform for Family Dental Health (and built to be sold or leased to other operators). Covers **project management, punch sheets, dispatch + time tracking, and item-cost tracking**, with three user roles.

Comparable products: Jobber, Housecall Pro, ServiceTitan (field service); Buildertrend, Fieldwire (projects + punch lists).

## Stack

Ported from the proven `comley-nexus` stack:

- **Frontend**: React 19 + Vite + Tailwind v4 (SPA, React Router)
- **API**: Express (Node), capability-gated REST
- **Data**: Supabase/Postgres — or a built-in in-memory demo store (zero setup)
- **Auth**: Clerk — or a dev bypass (no login) when Clerk isn't configured
- **Tenancy**: `orgs` + `org_members`; `org_id` is server-injected, never trusted from the client

## Quick start

```bash
npm install
cp .env.example .env      # optional — defaults run in demo mode
npm run dev               # web on :5173, API on :5050
```

Open http://localhost:5173. With no `.env`, you're signed in as a dev **Manager Admin** on a seeded "Family Dental Health" workspace with demo data. No database or login required.

## Roles

| Role | Can do |
|------|--------|
| **Manager Admin** | Everything — projects, dispatch, items, team |
| **Accountant Admin** | Item costs, service rates, financials; read-only dispatch |
| **Dispatcher** | Jobs, punch items, time, material usage |

Permissions live in one map: [lib/auth.js](lib/auth.js) → `CAPABILITIES`.

## Going to production

1. Create a Supabase project, run [db/schema.sql](db/schema.sql) (SQL editor or `npm run db:apply`), set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. Create a Clerk app, set `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY`, and list owner emails in `ADMIN_EMAILS`.
3. `npm run build` → Express serves `dist/` and the API from one process.

See [HANDOFF.md](HANDOFF.md) for architecture details and the next-steps backlog.
