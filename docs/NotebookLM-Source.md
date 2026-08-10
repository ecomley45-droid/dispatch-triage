# Nexus Field — Product & Technical Source Document

> **Purpose of this document.** This is a single, self-contained source file written to be
> loaded into a Notebook LLM (e.g. NotebookLM) so it can generate media — audio overviews,
> explainer videos, briefing docs, slide decks, FAQs, and marketing copy — about the product.
> It bundles the technical architecture, the full capability catalog, competitive positioning,
> personas, and business model. It is written in plain prose so a language model can narrate it.
> Everything here reflects the actual codebase as of **August 2026**.

---

## 1. Executive summary (the 30-second version)

**Nexus Field** is a multi-tenant, mobile-first **field-service management (FSM) platform** — the
software a service business uses to run its whole operation: customers and their equipment, work
orders, scheduling and dispatch, technician time tracking, materials/inventory costing, invoicing
and online payments, preventive-maintenance contracts, and a self-service customer portal.

It was built for a real first customer, **Family Dental Health** (a multi-location dental group in
SC/NC/GA), but it is deliberately architected as a **white-label SaaS product to be sold or leased
to other service operators**. Think of the category leaders — **Jobber, Housecall Pro,
ServiceTitan, FieldEdge, Buildertrend, Fieldwire** — Nexus Field targets the same jobs-to-be-done
for small and mid-sized service businesses, but at a leaner price point and with a "runs with zero
setup" engineering posture.

Three things make it distinctive:

1. **It runs with zero setup.** Clone it and run one command — no database, no login server, no
   API keys required to see a fully working, seeded workspace. That makes demos, evaluation, and
   development frictionless.
2. **A permission system that is a product feature, not just plumbing.** Beyond three built-in
   roles, workspace admins get a visual **Role Editor** to define custom roles (which pages a role
   can see, which actions it can take) — all enforced server-side.
3. **True multi-tenancy with white-label branding and a platform operator console** ("Nexus Super
   Admin"), so one deployment can host many client businesses, each on its own subdomain, with its
   own colors, logo, and Stripe subscription.

---

## 2. What problem it solves

A service business (dental equipment maintenance, HVAC, plumbing, electrical, appliance repair,
general contracting, facilities) juggles a chain of work that usually lives across a whiteboard, a
spreadsheet, a paper invoice book, and a group text:

- A **customer** calls with a problem at one of their **sites**, often about a specific piece of
  **equipment (asset)**.
- Someone creates a **work order**, sets a priority and an SLA due date, and **schedules** a
  technician.
- The **technician** drives out, clocks their **time**, records the **parts/materials** used, takes
  **photos**, writes **resolution notes**, and captures the customer's **signature**.
- A **manager approves** the completed job.
- An **invoice** is generated from the work order, sent, and **paid** — ideally online.
- Recurring service contracts spawn **preventive-maintenance** visits automatically.
- The owner/accountant needs **reports**: revenue, outstanding A/R, labor cost, profitability.

Nexus Field turns that entire chain into one connected system, on the phone in the field and on the
desktop in the office, with every action tracked in an audit log.

---

## 3. Who it's for (personas)

**The Owner / Manager (role: Manager Admin).** Runs the business. Needs full visibility, approves
completed jobs and timesheet corrections, manages the team and their permissions, and reads the
reports. Full access to everything.

**The Bookkeeper / Accountant (role: Accountant Admin).** Owns the money side: item costs, service
rates, invoices, financial reports. Has read visibility into operations but is not the person
dispatching trucks.

**The Dispatcher / Technician (role: Dispatcher).** Lives in the field app. Sees work orders and the
schedule, clocks in and out, runs the per-job timer ("On the way" → "Start job" → "Job complete"),
records materials used, uploads photos, and captures customer sign-off — but only for their own
work.

**The Platform Operator (Nexus Super Admin).** Not a customer — this is the person running Nexus
Field as a business. Uses a separate console to create client workspaces, brand them, seed demo
data, manage members, and handle each workspace's subscription billing.

**The End Customer (Customer Portal).** The service business's own customer. Gets a private,
tokenized link (no password) to request service and pay invoices online.

---

## 4. Capability catalog (feature by feature)

This is the heart of the product. Each capability below maps to a real page/route in the app.

### 4.1 Dashboard
The landing screen. Shows the signed-in person's **shift clock** and their current/next job, plus a
single aggregated snapshot of the workspace (jobs, overdue work orders, outstanding A/R). It is
served by one aggregate API call for speed rather than many.

### 4.2 Customers, Sites & Assets (the CRM spine)
A three-level hierarchy that is the backbone of the whole system:
- **Customers** — the businesses you service (billing email, phone, billing address, payment terms,
  whether a PO is required, status, notes).
- **Sites** — each customer can have multiple physical locations.
- **Assets** — each site can have equipment you maintain (make, model, serial number, warranty
  date).

Because every work order can be tied to a site and an asset, each unit builds a **complete service
history** over time. Each customer also carries a **portal token** — the key to their self-service
portal (see 4.11).

### 4.3 Work Orders (the unit of work)
A work order is a single service job. Created from the Work Orders page or from a customer. Carries
customer/site/asset links, a title, **priority**, an **SLA due date**, an assignee, status, and
resolution notes. Work orders past their SLA are flagged **overdue** on the list, dashboard, and
schedule. Work orders have their own **sequential numbers** (WO-0001…), **line items** (billable +
cost), a **manager approval** step, and a customer-notify action.

### 4.4 Schedule board (dispatch)
A drag-and-drop **dispatch board** with Week / Month / Day / Techs views. Drag a card from
"Unscheduled" onto a day to schedule it; drag between days to reschedule; tap to set an exact time
and assign a technician; filter by technician to focus one person's route (dispatchers see only
their own). On phones the week/day views stack vertically.

### 4.5 Field actions & time tracking
Two clocks that work together:
- **Shift clock** — a daily start/end-of-day clock, in sync across the dashboard and schedule.
- **Per-job timer** — driven by field buttons: **"On the way"** (en route), **"Start job"** (on
  site, timer starts), **"Take break"** (pause), **"Stop Job"** (stop, return to scheduled),
  **"Job complete"** (stop + mark done). Only "Job complete" marks the job done — and a manager must
  still approve it before it is truly closed.

### 4.6 Completion & manager approval
On the work order the tech adds resolution notes and photos, captures the customer's sign-off
(printed name + signature), and taps "Job complete." A **manager then approves** to close it. A
completed-but-unapproved job stays "pending" — approval is the final, manager-only step.

### 4.7 Timesheets & missed-punch corrections
Timesheets roll up hours and labor cost by team member and project, with CSV export for payroll.
Forgot to clock in/out? A tech files a **punch correction** ("Fix a punch") with the correct times
and a reason; a manager **reviews and approves or rejects** it on the Timesheets page. The shift
record isn't created until a manager approves — nothing is silently altered.

### 4.8 Invoices & payments
Generate an invoice directly from a completed work order — its line items are copied in. Review the
draft (tax, due date, line items), "Mark as sent," then "Record payment" (full or partial) or "Mark
paid." **Outstanding A/R** (unpaid, sent invoices) surfaces on the dashboard and Invoices page.
"Print / PDF" hands the customer a copy. Managers can set a reusable **invoice template**. Online
card payment is available via **Stripe Checkout**.

### 4.9 Items & cost tracking (materials/inventory)
An **item catalog** (name, SKU, image, unit, unit cost) plus **usage records** (which item, on which
project/job, quantity, the unit cost captured at time of use). This feeds project P&L — material
cost is real, not estimated, because it's captured from what was actually consumed.

### 4.10 Projects & punch sheets
For larger, multi-visit jobs: a **project** (client, location, budget, dates, status) with a
**punch-list** of items (title, priority, assignee, photo, status you advance by tapping). Project
detail shows **P&L**: budget vs. logged material cost + labor (hours × service rate) with an
over/under bar.

### 4.11 Customer Portal (self-service, no login)
Each customer gets a **private tokenized link** — no password. From it they can **request service**
(which creates a work order in the system) and **pay invoices online** via Stripe. The link can be
**rotated** by a manager, which revokes the old one.

### 4.12 Preventive / recurring maintenance
Define **maintenance plans** (customer/site/asset, frequency: weekly, monthly, quarterly,
semiannual, annual). The system **auto-generates work orders** when a plan is due — on demand
("Generate due now") and daily via a cron across all workspaces — and advances each plan's next-due
date. This is the recurring-revenue engine for service contracts.

### 4.13 Reports (owner/accountant)
Date-range financial reporting computed from real data: invoices issued, revenue collected,
outstanding A/R, revenue by customer, work orders completed, billable vs. cost, labor. All
exportable to CSV. The reporting core is a pure, unit-tested function (no I/O).

### 4.14 Activity log (audit trail)
Every create/update/delete and key action is recorded to an **audit log** (who, what, when, which
record). Manager-only. This is the accountability layer.

### 4.15 Map view
A live **map** (Leaflet) with status-colored pins for jobs and directions links. Uses Azure Maps
tiles/geocoding when a key is set, otherwise free OpenStreetMap. Full-screen with a draggable bottom
sheet on mobile ("Find My" style).

### 4.16 AI assistant (optional)
An embedded, **advisory-only** AI assistant (backed by Anthropic's Claude, streaming) that helps
draft, summarize, and clarify work content — job notes, punch items, schedules, messages. It is
strictly **suggest-only**: it never takes actions, dispatches jobs, or makes legal/financial/safety
decisions, and it's instructed not to fabricate names, prices, or dates. Inert unless an API key is
configured; the key is server-only and never reaches the browser.

### 4.17 Team & the Role Editor
Managers add/invite members and assign roles. Beyond the three presets, the **Role Editor** lets an
admin create **custom per-workspace roles** — choosing exactly which pages a role can view and which
action capabilities it holds. This is a genuine differentiator versus fixed-role competitors.

### 4.18 Settings, personalization & data ownership
Workspace rename, service-offer/rate management, invoice template. Each person can **personalize**
navigation (pin/reorder nav items), turn on **High contrast** and larger **text size**
(accessibility), and toggle **light/dark mode**. Data ownership is explicit: a manager can **export a
full JSON backup** anytime, and the system takes an **automatic daily backup**.

### 4.19 Help center
A built-in, searchable help center with articles for every major workflow and a client-side keyword
search — plus a "Contact support" path.

---

## 5. Roles & permissions model

Authorization is a **capability map**, not a rank hierarchy, because the three roles aren't a clean
ladder — a dispatcher can touch jobs an accountant can't, and vice versa for item costs. There is
**one source of truth** (a permissions catalog) shared by the server (enforcement) and the client
(navigation + Role Editor UI), so they can never drift.

**The three preset roles:**

| Role | What they can do |
|------|------------------|
| **Manager Admin** | Everything — work orders, scheduling, approvals, invoices, team, roles, reports, activity log. |
| **Accountant Admin** | Billing, invoices, item costs, service rates, reports; read visibility into operations. |
| **Dispatcher** | Work orders, scheduling, field work, materials, and *their own* time. |

**Two layers of enforcement:** *pages* are the "view" gate (server-enforced on reads — a role that
can't see a page gets a 403, not just a hidden menu), and *capabilities* are the "edit/action" gate
within a page. **Custom roles** (from the Role Editor) unify the two: you can only read what you can
see. Everything is enforced server-side; the UI guard is just UX.

---

## 6. Technical architecture

**Frontend:** React 19 + Vite + Tailwind v4, a single-page app with React Router. Route-level code
splitting — each page (and heavy deps like the Leaflet map) is a separate chunk loaded on first
navigation, keeping the initial bundle small. Mobile-first shell: a teal sidebar on desktop; a
sticky top bar + fixed bottom nav on phones; tables that scroll, modals that become bottom sheets,
16px inputs (no iOS zoom), safe-area padding.

**Backend/API:** Express (Node), a capability-gated REST surface. A generic **resource factory**
generates CRUD routes for each collection with a **column allowlist** (the client can only write
approved fields; `org_id`/`id` are never client-writable), owner-stamping, bounded **keyset
pagination** on every list (no unbounded queries), and read-gating by page permission.

**Data:** Supabase / Postgres in production — **or** a built-in **in-memory demo store** when no
database is configured, which is what makes zero-setup possible. The data layer is **org-scoped**:
the tenant id is always injected server-side from the authenticated session and never trusted from
the client, so one tenant can't reach another's data even with a forged request.

**Auth:** Clerk (with Microsoft/Entra SSO as the intended path — it's a Microsoft-first shop) — **or**
a dev bypass (no login) when Clerk isn't configured, which signs you in as a Manager Admin on the
seeded workspace. Production refuses to start without a Clerk secret key. Per-request caches (60s
TTL) avoid a Clerk network call on every request.

**Multi-tenancy & white-label routing:** tenants are `orgs` + `org_members`. The active workspace
lives in the URL (`/space/<slug>/…`) and is validated against the caller's memberships. Each client
runs on its own **subdomain** with its own **branding** (display name, primary color, sidebar color,
logo). The **platform operator console** ("Nexus Super Admin") lives on a separate admin subdomain
and is gated by a dedicated platform-admin allowlist — the client-admin and platform-operator tiers
never conflate.

**Optional, inert-by-default integrations** (each does nothing unless configured):
- **Stripe** — online invoice payments + platform subscription billing.
- **Anthropic Claude** — the AI assistant.
- **Sentry** — error monitoring (front and back).
- **Supabase Realtime** — live "who's online" team presence.
- **Azure Maps** — map tiles/geocoding (falls back to OpenStreetMap).
- **Microsoft Graph / Outlook** — the intended email path (Microsoft-first).

**Security posture** (engineering standards applied): default-deny authorization; allowlist input
validation; tenant scoping enforced in the data layer (impossible to omit); rate limiting on public
and expensive endpoints; Helmet + an **enforced Content-Security-Policy**; security headers
(HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy); **row-level security**
migration; secrets kept server-only; a full JSON export so no customer is ever locked in;
**additive, idempotent, checksum-tracked migrations**; and graceful "run the migrations" messaging
if code is deployed ahead of a migration.

**Deployment:** Vercel — the SPA and the API run from one process/function; pushes to `main`
auto-deploy. `npm run build` produces the static client, which Express serves alongside the API.

**Testing:** a Node test runner covers the P&L/labor/duration calculations and the role/capability
matrix — the money math and the access rules, the two things you least want wrong.

---

## 7. Data model (the nouns)

The Postgres schema (also the shape of the in-memory store):

`orgs` (tenants, with plan, feature flags, branding, Stripe fields) · `org_members` (who belongs to
a workspace and their role) · `roles` (custom per-workspace roles) · `customers` → `sites` →
`assets` (the CRM spine) · `work_orders` + `work_order_lines` · `invoices` + `invoice_lines` ·
`maintenance_plans` · `projects` + `punch_items` · `service_offers` (billable rates) · `jobs`
(dispatch) · `time_entries` + `shifts` + `timesheet_requests` · `items` + `item_usage` (materials) ·
`attachments` (photos + timestamped notes) · `audit_log` (the activity trail).

The flow, as one sentence: **a customer's asset at a site generates a work order, which is
scheduled and worked (time + materials + photos), approved, invoiced, and paid — and recurring plans
spawn those work orders automatically.**

---

## 8. Competitive landscape & positioning

**The category:** Field Service Management (FSM) software.

**Direct comparables:**
- **Jobber** — small-business FSM (quoting, scheduling, invoicing). Nexus Field covers the same core
  loop.
- **Housecall Pro** — SMB home-services FSM with strong payments and a consumer-facing angle.
- **ServiceTitan** — the enterprise heavyweight for trades (HVAC/plumbing/electrical); powerful but
  expensive and heavy to adopt.
- **FieldEdge** — service contractors, strong on maintenance agreements and QuickBooks.
- **Buildertrend / Fieldwire** — project-and-punch-list-oriented (construction). Nexus Field's
  Projects + Punch-sheet module overlaps here.

**Where Nexus Field positions:** the **underserved small-to-mid service business** that finds
ServiceTitan too heavy and expensive, but wants more than a single-purpose invoicing app. It
bundles CRM + scheduling + time + materials + invoicing + maintenance contracts + a customer portal
in one place.

**Differentiators to lead with in media:**
1. **Zero-setup and lightweight** — fast to demo, fast to onboard, cheaper to run.
2. **Custom roles via a visual Role Editor** — most competitors ship fixed roles; Nexus Field lets
   each business shape access to its own org chart, enforced server-side.
3. **White-label multi-tenancy + operator console** — it's not just an app, it's a platform you can
   resell; each client gets its own branded subdomain and subscription.
4. **Data ownership by design** — one-click full JSON export, automatic daily backups, no lock-in.
5. **Preventive-maintenance automation** — recurring contracts that generate work orders on their
   own, the recurring-revenue engine service businesses want.
6. **Mobile-first for the field** — built for a phone in a truck, not a desktop retrofit.
7. **Advisory AI that stays in its lane** — helps draft and summarize, never acts autonomously.

**Honest limitations / roadmap** (useful for a balanced briefing): Microsoft Entra SSO and a Clerk
production instance are the intended-but-final auth steps; a native mobile app (React Native/Expo)
is a future step (the REST API is already a clean surface for it); some integrations are
configured-but-optional. It is an early-stage product (v0.1) with its money math and access rules
under test, hardened for pre-revenue but still pre-scale.

---

## 9. Business model

Nexus Field is built to be **sold or leased**. The economics:

- **SaaS subscription per client workspace**, billed through Stripe (monthly and yearly intended),
  managed from the Super Admin console. Each workspace tracks its own Stripe customer/subscription.
- **White-label / reseller angle** — one deployment hosts many client businesses on their own
  branded subdomains, so a single operator can run a portfolio of clients.
- **First reference customer:** Family Dental Health (multi-location dental group, SC/NC/GA) — a real
  operating tenant, not a mock, which is the credibility anchor for selling to the next customer.
- **Low cost to serve** — the zero-setup, dependency-light architecture and free-tier-friendly
  integrations (OpenStreetMap, dev-tier services) keep per-tenant cost down.

---

## 10. Talking points & sound bites (for narration / marketing)

Short, media-ready lines a Notebook LLM can quote or riff on:

- "Nexus Field runs your whole service business from the first customer call to the paid invoice —
  on the phone in the truck and on the desktop in the office."
- "From asset to work order to invoice to payment — and back around again with automatic
  maintenance visits."
- "Most field-service apps hand you three fixed roles. Nexus Field lets you design your own — and
  enforces them where it matters, on the server."
- "It's not just software you buy — it's a platform you can resell. Each client gets their own
  branded workspace and their own subscription."
- "Your data is yours: one click exports everything, and the system backs itself up every day."
- "Preventive maintenance that books itself — recurring contracts generate work orders on their
  own, so recurring revenue doesn't depend on someone remembering."
- "Built for the field first — a phone in a truck, not a desktop app squeezed onto a small screen."
- "The AI helps you write the note and summarize the day — it never dispatches a truck or makes a
  decision. A human is always in control."
- "Clone it, run one command, and you're inside a fully working workspace with real sample data —
  no database, no login, no setup."

---

## 11. Glossary (for accurate narration)

- **FSM** — Field Service Management, the software category.
- **Work order** — one service job; the central unit of work.
- **SLA due date** — the deadline a work order is measured against; past it, it's "overdue."
- **Punch list / punch item** — a checklist of remaining items on a larger project.
- **Shift clock vs. job timer** — the daily start/end-of-day clock vs. the per-job stopwatch.
- **Service offer / rate** — a billable service and its default rate, used for labor cost in P&L.
- **A/R (accounts receivable)** — money owed on sent-but-unpaid invoices.
- **Asset** — a specific piece of equipment at a customer site that you maintain.
- **Portal token** — the passwordless key that gives a customer access to their self-service portal.
- **Tenant / workspace / org** — one client business's isolated space in the platform.
- **Capability** — a single named permission (e.g. "approve work orders") assigned to roles.
- **Manager Admin / Accountant Admin / Dispatcher** — the three built-in roles.
- **Nexus Super Admin** — the platform operator's console for managing all client workspaces.
- **Zero-setup / dev bypass** — running the app with an in-memory store and no login, for demos and
  development.

---

*End of source document. All statements reflect the Nexus Field codebase as of August 2026.*
