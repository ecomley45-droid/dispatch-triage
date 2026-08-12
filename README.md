# Dispatch — Field Service Management

A multi-tenant, capability-gated field-service platform. It runs the full service
business loop — **customers → sites → assets → work orders → invoices → online
payment** — alongside dispatch, scheduling, projects/punch lists, item-cost
tracking, preventive maintenance, a customer support portal, and a platform
super-admin console for operating many client workspaces at once.

First tenant: Family Dental Health. Built to be sold or leased to other operators.

Comparable products: Jobber, Housecall Pro, ServiceTitan (field service);
Buildertrend, Fieldwire (projects + punch lists).

## Stack

Ported from the proven `comley-nexus` stack:

- **Frontend**: React 19 + Vite + Tailwind v4 (SPA, React Router, route-split, PWA)
- **API**: Express (Node), capability-gated REST
- **Data**: Supabase/Postgres — or a built-in in-memory demo store (zero setup)
- **Auth**: Clerk — or a dev bypass (no login) when Clerk isn't configured
- **Tenancy**: `orgs` + `org_members`; `org_id` is server-injected, never trusted
  from the client. The active workspace lives in the URL (`/:orgSlug/...`).

## Quick start

```bash
npm install
cp .env.example .env      # optional — defaults run in demo mode
npm run dev               # web on :5173, API on :5050
```

Open http://localhost:5173. With no `.env`, you're signed in as a dev
**Manager Admin** on a seeded "Family Dental Health" workspace with demo data —
no database or login required. The **Super Admin** console lives at
`/super-admin` (the dev viewer is always a platform admin locally).

## What's in the app

**Workspace (tenant) app**

- **Dashboard** — KPIs: active projects, open punch, scheduled jobs, material
  cost, open/overdue work orders, customers, outstanding A/R, open invoices.
- **CRM spine** — Customers → Sites → Assets (equipment with serial/warranty).
- **Work Orders** — sequential numbers, priority/status pipeline, SLA due,
  tech assignment (in-app notify), line items, **manager sign-off/approval**,
  customer **signature capture**, auto **"on the way" SMS**, and one-click
  **invoice generation** from a completed WO.
- **Dispatch & Schedule** — jobs board + calendar; **Map** with live technician
  GPS positions.
- **Projects & Punch lists** — large-job management with click-to-advance punch
  items and photos.
- **Items & cost tracking** — catalog + material-usage logging (cost-at-use).
- **Time** — shift clock in/out, time entries, **timesheet correction requests**
  with manager review.
- **Invoicing & payments** — invoices + lines, **Stripe Checkout** for the
  balance, and **Sage Intacct** push.
- **Tickets** — threaded customer support; staff replies email the customer.
- **Maintenance** — recurring plans that **auto-generate due work orders**
  (manual button + daily cron).
- **Reports** (date-range financials) and **Activity / audit log**.
- **AI assistant** (streaming), **notifications** bell + per-user prefs,
  **file/photo uploads**.
- **Customer Portal** — no-login, per-customer tokenized link: view work orders /
  invoices / tickets, submit service requests, pay invoices, open & reply to
  tickets.
- **Platform polish** — installable PWA (offline banner + outbound action queue),
  per-workspace branding (name/colors/logo/favicon), dark/light theme,
  font-size + navigation customization, multi-workspace switching, and full
  **JSON data export** (no lock-in).

**Super Admin console (`/super-admin`, platform operators only)**

Create/list client workspaces; per-workspace **Overview**, **Branding**,
**Integrations & Features** (feature flags + integration allowlist), **Billing**
(plan/subscription + Stripe portal), and **Members**; **demo-data seed / flush**;
**"view as"** impersonation of any role or the customer-portal perspective; a
multi-device **Simulator**; and a cross-workspace billing overview.

## Roles & authorization

Four preset roles plus **custom roles** (defined per workspace in the Role
Editor). Authorization is a single capability catalog — the **one source of
truth** shared by the server (enforcement) and the client (nav + Role Editor):
[lib/permissions.js](lib/permissions.js) → `CAPABILITIES` / `PAGES`.

| Role | Scope |
|------|-------|
| **Manager Admin** | Everything — CRM, work orders, dispatch, invoicing, team, roles, structure |
| **Accountant Admin** | Financials, invoices, item costs, service rates, reports; read-only ops |
| **Dispatcher** | Work orders, dispatch jobs, punch, tickets, time, material usage |
| **Technician** | *Restricted* — sees only their **own** assigned work/schedule/time/usage |

Two gates enforce every request server-side: **page view** (can the role *read*
this page's data) and **capability** (can the role perform this *write/action*).
**Regions & Teams** add a second scoping dimension — a region-restricted member
only sees their region's customers and work orders. `org_id` and the technician
self-scope are always injected from the verified session, never the client.

Platform **super-admins** are a separate tier (their own `PLATFORM_ADMIN_EMAILS`
allowlist), never conflated with a workspace's own Manager Admin.

## Data model

Every table is `org_id`-scoped (cascade on org delete). Core relationships:

```
orgs ─┬─ org_members (role, region_id, team_id)
      ├─ roles (custom permission sets)
      ├─ regions ── teams
      ├─ customers ─┬─ sites ── assets
      │             ├─ work_orders ─┬─ work_order_lines
      │             │               ├─ time_entries
      │             │               └─ invoices ── invoice_lines
      │             ├─ invoices
      │             ├─ tickets ── ticket_messages
      │             └─ maintenance_plans ──▶ (generates) work_orders
      ├─ projects ─┬─ punch_items
      │            └─ jobs ── time_entries
      ├─ service_offers ──▶ jobs
      ├─ items ── item_usage (→ projects/jobs)
      ├─ shifts, timesheet_requests
      ├─ attachments (polymorphic: entity_type + entity_id)
      ├─ notifications, notification_prefs
      ├─ integrations (encrypted secrets), audit_log
```

See [db/schema.sql](db/schema.sql) for the full schema (indexes included — every
foreign key is indexed).

## Architecture

```
index.html ─ vite ─▶ src/main.jsx ─▶ (ClerkProvider?) ─▶ MeProvider ─▶ App (router)
   │                                                                     │
   ├─ /super-admin  ─▶ src/super/SuperApp.jsx (platform console)         │
   └─ /:orgSlug/... ─▶ workspace app; src/lib/api.js ─ fetch /api/* ─────┘
                                          │
server.js (Express)
  ├─ lib/auth.js         resolveViewer → req.viewer + req.org; requireCapability / requirePageView
  ├─ lib/permissions.js  capability + page catalog (shared with the browser build)
  ├─ lib/store.js        org-scoped data layer; Supabase OR in-memory (auto)
  └─ lib/db.js           Supabase client singleton (null ⇒ in-memory)
```

Server-side reads/writes both go through the permission catalog, so hiding a nav
item never becomes the only line of defense. Lists are bounded (keyset-paginated,
default limit); the AI endpoint streams over SSE.

## Going to production

1. Create a Supabase project, run [db/schema.sql](db/schema.sql) (SQL editor or
   `npm run db:apply`), set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. Create a Clerk app, set `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY`, list
   workspace-owner emails in `ADMIN_EMAILS`, and platform operators in
   `PLATFORM_ADMIN_EMAILS`.
3. Optional integrations: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (payments),
   `SECRETS_KEY` (encrypt per-workspace integration credentials, e.g. Sage
   Intacct), email/SMS senders, `CRON_SECRET` (maintenance + backup crons),
   `SENTRY_DSN`.
4. `npm run build` → Express serves `dist/` and the API from one process.

See [HANDOFF.md](HANDOFF.md) for deeper architecture notes.

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Web (:5173) + API (:5050) with hot reload |
| `npm run build` | Production SPA bundle into `dist/` |
| `npm run server` | API / prod server only |
| `npm run db:apply` | Apply `db/schema.sql` to Supabase |
| `npm run seed:demo` | Seed demo data |
| `npm test` | Node test runner (`tests/*.test.js`) |
</content>
</invoke>
