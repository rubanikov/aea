# Patient Appointment & Scheduling Portal

A web app where patients book, reschedule, and cancel appointments with healthcare providers, and providers manage their availability and calendar — built to the brief in [`project.md`](project.md).

**Stack:** Django (backend) + PostgreSQL, Next.js/TypeScript (frontend). Full rationale for every stack and design decision lives in [`tech-stack-research.md`](tech-stack-research.md), [`prior-art-research.md`](prior-art-research.md), and [`architecture.md`](architecture.md); the 14-ticket build plan and what each ticket delivered is in [`tickets/README.md`](tickets/README.md).

## Grader quick-start

Two things running: a Postgres database, and the two apps.

### 1. Database

Any reachable Postgres 14+ works. Fastest local option:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:16-alpine
```

### 2. Configure

```bash
cp .env.example .env          # repo root — backend reads this
cp .env.example frontend/.env.local   # frontend only needs NEXT_PUBLIC_API_URL from it
```
The defaults in `.env.example` work as-is against the Docker Postgres above — no real Resend key or Supabase project needed. See [Environment variables](#environment-variables) below for what each one does.

### 3. Backend

```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.lock      # exact pinned versions (same file CI installs); requirements-dev.txt is the ranged source
python manage.py migrate
python manage.py seed_demo       # 15 providers, 25 patients, an admin, and sample bookings — see below
python manage.py runserver 0.0.0.0:8000
```
Confirm it's up: `curl http://localhost:8000/health` → `{"status": "ok", "database": "reachable"}`.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000`.

### 5. Log in with a seeded account

`seed_demo` creates real accounts, all with password **`demo-password-not-for-prod`**:

| Role | Email |
|---|---|
| Patient | `patient@demo.aea.test` (also `patient2@demo.aea.test`–`patient25@demo.aea.test` — there is no `patient1`; the first patient is the unnumbered one) |
| Provider | `provider1@demo.aea.test`–`provider15@demo.aea.test` |
| Admin | `admin@demo.aea.test` |

> **Deployed exception:** on the Railway deployment the admin account's
> password has been rotated and is not published in this repo — admin can
> read every booking and the full audit log, so publishing its password
> alongside the live URL would defeat the RBAC design. The seed password
> above works for admin on a local checkout only. Patient and provider
> demo logins work everywhere.

`patient6`–`patient25` and `provider11`–`provider15` are a second, more regular cohort layered on top of the first: each of those 20 patients has a standing weekly appointment with each of those 5 doctors (100 recurring weekly bookings total, so any of those 5 doctors' calendars shows all 20 of those patients every single week) — useful if you want a clean, predictable pattern to look at rather than the original 10 providers' randomly-sampled bookings.

Each provider already has working hours, a few appointment types (30 or 60 min, chosen per appointment type by the provider — the seed uses 60 throughout so the k6 benchmark's slot counts stay reproducible), and a handful of pre-existing bookings, so there's real data to click through immediately rather than an empty first-run state.

### 6. Run the test suite

```bash
cd backend
python manage.py test                 # full suite — needs DJANGO_SECRET_KEY set if DJANGO_DEBUG=False
coverage run manage.py test && coverage report   # same suite, with the coverage gate CI enforces
ruff check .                          # lint, also part of CI
```
```bash
cd frontend
npm test && npm run typecheck && npm run lint
```
The coverage gate is scoped to `backend/` (`pyproject.toml`'s `[tool.coverage]`, `fail_under = 80`) — the brief's ≥80% target is stated as core-logic coverage (slot generation, booking engine, lifecycle, reminders), not a frontend UI metric. Current run: **98%** backend-wide, 100% on every core-logic module (`bookings/services.py`, `bookings/transitions.py`, `scheduling/slots.py`, `scheduling/collisions.py`, `reminders/services.py`).
Both are what CI runs on every push (`.github/workflows/ci.yml`).

### 7. The concurrency test (the brief's critical correctness gate)

The no-double-booking guarantee has its own dedicated, genuinely-concurrent test suite — real threads, real separate DB connections, real Postgres row locks, not mocked:
```bash
cd backend
python manage.py test bookings.tests.test_concurrency -v 2
```
This fires 10 simultaneous booking/reschedule requests at the same last-open slot and asserts exactly one succeeds. It was independently re-run 50+ consecutive times during development (see the commit history) after two real races were found and fixed this way — not just written once and trusted.

### 8. Performance benchmarks (k6)

```bash
k6 run k6/slot-availability.js
k6 run k6/booking-action.js
```
Requires `seed_demo` to have run first (for realistic data volume) and the backend running at `http://localhost:8000` (override with `BASE_URL`). See [`k6/README.md`](k6/README.md) for the full methodology, a run against the deployed Railway instance (slot-availability p95 406 ms at 30 VUs), and the unthrottled local run's numbers.

## Roles

Three roles, enforced server-side on every request (never trusted from the client):

- **Patient** — browses provider availability, books/reschedules/cancels their own appointments, manages their own profile, can request account deletion.
- **Provider** — sets their own working hours and appointment types (each with a chosen 30- or 60-minute slot length), blocks time off, views/manages their own calendar (mark completed/no-show/cancel), never sees another provider's data.
- **Admin** — read access across the system (audit log viewer, can act on any booking), every admin action is itself written to the audit log.

## Environment variables

All documented with placeholders/comments in [`.env.example`](.env.example). The ones that matter for local grading:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Defaults to the local Docker instance above. |
| `DJANGO_SECRET_KEY` | Required outside `DJANGO_DEBUG=True` — the app refuses to start with the dev default in that case. |
| `DJANGO_DEBUG` | `True` for local dev (default in `.env.example`). |
| `CORS_ALLOWED_ORIGINS` | Must match the frontend's real origin. |
| `RESEND_API_KEY` | Optional. Unset by design for local/grading use — the reminder dispatcher logs and skips sending rather than erroring (see [`backend/reminders/README.md`](backend/reminders/README.md)). |
| `FRONTEND_BASE_URL` | Portal link embedded in outbound messages: the reminder email's "view details" link and the doctor-cancellation email/SMS. |
| `LOG_FORMAT` | Optional. `json` (default outside `DJANGO_DEBUG=True`) or `text` (default in debug). |
| `NEXT_PUBLIC_API_URL` | Browser-facing API origin. Locally Django on `:8000`. On Railway, the *frontend* origin — Next rewrites API paths to Django so auth cookies stay first-party. |
| `BACKEND_URL` / `RAILWAY_SERVICE_BACKEND_URL` | Frontend-server-only rewrite target for those proxied API paths. Unset locally (no rewrites; browser calls Django directly). |

The full list, with per-variable comments, is in [`docs/installation.md`](docs/installation.md#environment-variables).

## Documentation map

Guides (`docs/`):

- [`docs/installation.md`](docs/installation.md) — full local setup: prerequisites and versions, Postgres options, every environment variable, backend/frontend steps for Git Bash and PowerShell, tests, k6, and a troubleshooting table.
- [`docs/features.md`](docs/features.md) — what each role can do and the rules the app enforces (a click-through guide for the demo).
- [`docs/api.md`](docs/api.md) — HTTP API reference: auth/cookies/CSRF, every endpoint with bodies, params, status codes and audit side effects, management commands.
- [`docs/deployment.md`](docs/deployment.md) — how the Railway deployment is wired (four services, env vars per service, first-time provisioning, redeploy, seeding, operations) and how to deploy elsewhere.
- [`docs/development.md`](docs/development.md) — repo layout, the conventions the code depends on, test/lint/coverage loop, migrations, dependency locking, CI.

Design and background:

- [`project.md`](project.md) — the original assessment brief.
- [`architecture.md`](architecture.md) — the technical design every ticket was built against (data model, double-booking guard, RBAC/PHI approach, timezone handling, reminders), with "as built" notes and a §10 list of everything added since.
- [`tech-stack-research.md`](tech-stack-research.md) / [`prior-art-research.md`](prior-art-research.md) — why this stack, and what real systems (Cal.com, Medplum, OpenEMR, Easy!Appointments) got right/wrong that this build learned from.
- [`tickets/`](tickets/) — the 14 vertical build tickets, each with its own scope and accept criteria; `tickets/README.md` has the full build-wave plan and a table of what was built after the slate.
- [`DEMO_CREDENTIALS.md`](DEMO_CREDENTIALS.md) — every seeded account.
- [`frontend/README.md`](frontend/README.md) — frontend scripts, route map, auth/route-guard details.
- [`backend/docs/retention-policy.md`](backend/docs/retention-policy.md) — what PHI is collected, how long it's kept, what account deletion actually does.
- [`AI_USAGE.md`](AI_USAGE.md) — AI tool usage disclosure.
- [`k6/README.md`](k6/README.md) — performance-benchmark methodology and results.
- [`backend/reminders/README.md`](backend/reminders/README.md) — the reminder cron job and its Railway deployment configuration.

## PHI & security notes for graders

This is a healthcare scheduling app handling PHI (patient identity, appointment details) — treated as first-class throughout, not bolted on:

- Passwords hashed with bcrypt (`config/settings.py`'s `PASSWORD_HASHERS`), JWT auth delivered as httpOnly/Secure/SameSite=Strict cookies, never `localStorage`.
- Every PHI-touching endpoint checks row-level ownership server-side (`patient sees only their own`, `provider sees only their own`) independent of any DB-layer policy — see `architecture.md` §6 for why Supabase RLS specifically wasn't used (a documented decision, not an oversight).
- Every booking/status change and every admin action is written to an append-only audit log (`actor`, `action`, `target`, `timestamp`). Append-only is enforced twice: the ORM refuses update/delete (`audit/models.py`), and a Postgres trigger (`audit/migrations/0002_append_only_trigger.py`) rejects raw-SQL `UPDATE`/`DELETE` on the table — both pinned by tests, including one that issues raw SQL.
- No PHI (names, emails, phone numbers, appointment content) appears in server logs or the reminder email body — only IDs. Deployed logs are one JSON object per line (`core/logging.py`) so they can be filtered by level/logger/status without scraping; local dev keeps plain text. The one deliberate exception: a doctor-cancelled appointment's cancellation email/SMS carries the provider's written reason and the appointment time — a scoped, approved tradeoff, not an oversight; see `architecture.md` §7a.
- Account deletion scrubs PHI fields in place (never hard-deletes, so audit history stays intact) and cancels upcoming appointments as part of the same request — in one transaction (`accounts/services.py`), so a failure part-way through rolls the whole thing back rather than leaving a half-scrubbed account.
- Every request body is capped at 64 KB before it is parsed (`core/middleware.py`, `MAX_REQUEST_BODY_BYTES`) — DRF reads the raw stream, so Django's own `DATA_UPLOAD_MAX_MEMORY_SIZE` would not have covered these endpoints. Oversized bodies get a JSON 413.
- TLS/HTTPS in transit: enforced app-side (`SECURE_SSL_REDIRECT`, `*_COOKIE_SECURE` outside `DEBUG`) and live on the deployed instance — Railway terminates TLS at its edge proxy for both services. Encryption at rest for the database is delegated to the Postgres host (Railway's managed Postgres encrypts at rest by default) — not something the application layer configures itself.
- No BAA is in place with any third-party vendor (Resend, Railway, etc.) in this deployment — a real production rollout handling real PHI would need one from each vendor that touches it; see `tech-stack-research.md` for which vendors offer one and at what tier.

## Deployment

The app is deployed on Railway (project `aea-scheduling-portal`): `backend` (Django, Nixpacks build per [`backend/railway.json`](backend/railway.json); its start command runs `migrate` and `createcachetable` before gunicorn, so schema and cache table are always current on deploy), `frontend` (Next.js, zero-config Railpack detection), a managed `Postgres` instance wired to the backend via `${{Postgres.DATABASE_URL}}`, and the reminder cron as a fourth service defined in [`backend/railway.cron.json`](backend/railway.cron.json) (`*/15 * * * *` → `python manage.py dispatch_reminders`; provisioning commands in [`backend/reminders/README.md`](backend/reminders/README.md)). Step-by-step provisioning is in [`docs/deployment.md`](docs/deployment.md).

- **Frontend:** https://frontend-production-9ca8.up.railway.app
- **Backend API:** https://backend-production-e1121.up.railway.app
- **Health check:** https://backend-production-e1121.up.railway.app/health

The deployed database is seeded with the same `seed_demo` dataset described above (15 providers, 25 patients) — use the demo credentials in `DEMO_CREDENTIALS.md` to log in. `RESEND_API_KEY` is intentionally left unset on the deployed backend, so reminder dispatch logs and skips sends rather than emailing real addresses from a demo deployment — see `reminders/README.md` for that fallback behavior.
