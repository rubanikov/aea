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
pip install -r requirements-dev.txt
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

`patient6`–`patient25` and `provider11`–`provider15` are a second, more regular cohort layered on top of the first: each of those 20 patients has a standing weekly appointment with each of those 5 doctors (100 recurring weekly bookings total, so any of those 5 doctors' calendars shows all 20 of those patients every single week) — useful if you want a clean, predictable pattern to look at rather than the original 10 providers' randomly-sampled bookings.

Each provider already has working hours, a few appointment types (10–60 min, per real scheduling norms — see `tech-stack-research.md`), and a handful of pre-existing bookings, so there's real data to click through immediately rather than an empty first-run state.

### 6. Run the test suite

```bash
cd backend
python manage.py test                 # full suite — needs DJANGO_SECRET_KEY set if DJANGO_DEBUG=False
coverage run manage.py test && coverage report   # same suite, with the coverage gate CI enforces
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
Requires `seed_demo` to have run first (for realistic data volume) and the backend running at `http://localhost:8000` (override with `BASE_URL`). See [`k6/README.md`](k6/README.md) for the full methodology and a real local run's numbers.

## Roles

Three roles, enforced server-side on every request (never trusted from the client):

- **Patient** — browses provider availability, books/reschedules/cancels their own appointments, manages their own profile, can request account deletion.
- **Provider** — sets their own working hours and appointment types, blocks time off, views/manages their own calendar (mark completed/no-show/cancel), never sees another provider's data.
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
| `FRONTEND_BASE_URL` | Used only inside the reminder email's "view details" link. |
| `NEXT_PUBLIC_API_URL` | Frontend → backend base URL. |

## Documentation map

- [`project.md`](project.md) — the original assessment brief.
- [`architecture.md`](architecture.md) — the technical design every ticket was built against (data model, double-booking guard, RBAC/PHI approach, timezone handling, reminders).
- [`tech-stack-research.md`](tech-stack-research.md) / [`prior-art-research.md`](prior-art-research.md) — why this stack, and what real systems (Cal.com, Medplum, OpenEMR, Easy!Appointments) got right/wrong that this build learned from.
- [`tickets/`](tickets/) — the 14 vertical build tickets, each with its own scope and accept criteria; `tickets/README.md` has the full build-wave plan.
- [`backend/docs/retention-policy.md`](backend/docs/retention-policy.md) — what PHI is collected, how long it's kept, what account deletion actually does.
- [`AI_USAGE.md`](AI_USAGE.md) — AI tool usage disclosure.
- [`k6/README.md`](k6/README.md) — performance-benchmark methodology and results.
- [`backend/reminders/README.md`](backend/reminders/README.md) — the reminder cron job and its Railway deployment configuration.

## PHI & security notes for graders

This is a healthcare scheduling app handling PHI (patient identity, appointment details) — treated as first-class throughout, not bolted on:

- Passwords hashed with bcrypt (`config/settings.py`'s `PASSWORD_HASHERS`), JWT auth delivered as httpOnly/Secure/SameSite=Strict cookies, never `localStorage`.
- Every PHI-touching endpoint checks row-level ownership server-side (`patient sees only their own`, `provider sees only their own`) independent of any DB-layer policy — see `architecture.md` §6 for why Supabase RLS specifically wasn't used (a documented decision, not an oversight).
- Every booking/status change and every admin action is written to an append-only audit log (`actor`, `action`, `target`, `timestamp`) — verified by dedicated tests that no update/delete path exists for it.
- No PHI (names, emails, phone numbers, appointment content) appears in server logs or the reminder email body — only IDs. The one deliberate exception: a doctor-cancelled appointment's cancellation email/SMS carries the provider's written reason and the appointment time — a scoped, approved tradeoff, not an oversight; see `architecture.md` §7a.
- Account deletion scrubs PHI fields in place (never hard-deletes, so audit history stays intact) and cancels upcoming appointments as part of the same request.
- TLS/HTTPS in transit: enforced app-side (`SECURE_SSL_REDIRECT`, `*_COOKIE_SECURE` outside `DEBUG`) whenever it's deployed behind a proxy that terminates TLS, which is how Railway/Vercel both work by default. Encryption at rest for the database is delegated to the Postgres host (Supabase and Railway's managed Postgres both encrypt at rest by default) — not something the application layer configures itself, since no live database was provisioned as part of this build (see Deployment below).
- No BAA is in place with any third-party vendor (Resend, Railway, etc.) in this deployment — a real production rollout handling real PHI would need one from each vendor that touches it; see `tech-stack-research.md` for which vendors offer one and at what tier.

## Deployment

Deploy-ready configuration is committed (`backend/railway.json`, standard Next.js zero-config detection for Vercel), but no live infrastructure was provisioned as part of this build — provisioning real cloud accounts was treated as a separate, explicit decision outside the scope of writing the application itself.
