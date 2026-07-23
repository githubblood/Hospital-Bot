# Hospital WhatsApp Chatbot — SaaS Platform

A multi-tenant hospital management platform built around a deterministic WhatsApp
appointment-booking chatbot: patients book, reschedule, and cancel appointments entirely
over WhatsApp, while hospital staff run the day-to-day (reception, queue, billing,
reports) from a full admin panel, and a separate platform-level console manages hospitals
and subscriptions across the whole SaaS.

## What it does

- **WhatsApp bot** (patient-facing): a config-driven state machine — no AI/NLP anywhere —
  that adapts its flow per hospital (single clinic vs. multi-branch/multi-department
  chain) based on flags stored on the hospital record. Handles booking, rescheduling,
  cancellation, capacity/waitlist, bilingual (English/Hindi) messaging, and emergency
  overrides.
- **Hospital admin panel**: JWT-authenticated, role-gated (Receptionist / Hospital
  Administrator / Super Admin) staff console — dashboard & analytics, appointments,
  doctors & schedules, patients, billing, reception & live queue, departments/branches,
  reports (PDF/CSV/XLSX), staff management, hospital settings.
- **Platform admin console**: a separate, higher-privilege login for the SaaS operator —
  cross-hospital dashboard, hospital lifecycle (suspend/activate), subscription plans and
  billing state, audit log.
- **Multi-tenant by construction**: every hospital-facing query is scoped by
  `hospital_id`; the platform console uses a structurally separate `platform_admins`
  table and JWT `token_type` claim so a hospital token can never reach platform routes
  (or vice versa).

## Architecture

```
frontend/     Static admin panel (plain HTML/CSS/JS, no framework/bundler).
              Deployable as-is on Vercel (or served by the backend directly).

backend/      Express API + the WhatsApp webhook + the background reminder job.
  src/
    app.js, server.js      Express bootstrap
    config/db.js           Postgres/MySQL dual-mode DB layer (see below)
    controllers/, routes/  Thin HTTP layer
    services/              Business logic (booking, billing, reports, RBAC, ...)
    middleware/            Auth (JWT, role, plan-tier), rate limiting, uploads
    validators/            Input validation helpers
    jobs/                  Background jobs (appointment reminder scan)
    webhook/                The WhatsApp state machine: handlers/ (one per
                            conversation state), helpers/ (session, config
                            lookup, option-menu resolution), messages.js
                            (all bilingual copy), the dispatcher, capacity/
                            queue logic

database/     schema.sql — the full current Postgres schema

docs/         Point-in-time work-summary notes
tests/        No automated suite yet — see tests/README.md for how this
              project is actually verified (driven scripts + Playwright)
scripts/      One-off ops scripts (e.g. creating the first platform admin)
```

**Why the backend is one Express app serving three different surfaces** (`/webhook` for
Meta, `/api/admin` for hospital staff, `/api/platform` for the SaaS operator): they share
one codebase and one database, but are deliberately kept apart — different auth
middleware, different JWT `token_type`, and (for platform vs. hospital) no shared query
ever crosses tenant boundaries by construction, not just by convention.

## Tech stack

- **Runtime**: Node.js + Express 4
- **Database**: Postgres (Supabase) in production, with a MySQL fallback path for local
  rollback (`backend/src/config/db.js` is a compatibility shim so the ~300 existing query
  call sites didn't need a rewrite — see the comments in that file for the translation
  rules)
- **Auth**: JWT (`jsonwebtoken` + `bcryptjs`), two independent token types
- **WhatsApp**: Meta Cloud API (`axios` against the Graph API)
- **PDF/CSV/XLSX reports**: `pdfkit`, hand-rolled CSV, `exceljs`
- **No frontend framework** — the admin panel is plain HTML/CSS/JS on purpose, so it can
  be understood and deployed with zero build step

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, META_* vars, etc.
npm run dev             # nodemon backend/src/server.js
```

Then either:
- Open `http://localhost:3000/admin/index.html` (backend serves the admin panel directly
  — the default, same-origin setup, nothing else to configure), or
- Run the WhatsApp bot's own verification flow — see `.claude/skills/verify/SKILL.md` for
  the exact method (simulated webhook payloads + seeded test data).

To apply the schema to a fresh database, run `database/schema.sql` against it directly
(see `database/README.md`).

## Deployment

Currently deployed as:
- **Backend** (this repo's `backend/`, `database/`, and API surface) on **Railway** — no
  extra config beyond `package.json`'s `start` script, which Railway runs automatically.
- **Frontend** (`frontend/`) optionally on **Vercel** as a separate static deploy, talking
  to the Railway backend cross-origin. To do this:
  1. Create a Vercel project with **Root Directory** set to `frontend`.
  2. Set `API_BASE_URL` in `frontend/js/config.js` to the Railway backend's URL.
  3. Set `ALLOWED_ORIGIN` on Railway to the Vercel domain (comma-separate for multiple).

  If the backend serves the admin panel itself (the default, same-origin setup), none of
  this is needed — `API_BASE_URL` stays empty and `ALLOWED_ORIGIN` stays unset.
- **Database**: Supabase (Postgres).

## No automated tests

See `tests/README.md` — verification is done against the real running app (syntax
checks, driven API/webhook scripts, and Playwright for the UI), not a CI test suite.
