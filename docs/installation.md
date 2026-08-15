# Installation guide

Everything needed to run the Patient Appointment & Scheduling Portal on a
laptop, from a clean checkout to a logged-in demo account. The root
[`README.md`](../README.md#grader-quick-start) has the eight-command short
version; this page is the long one, with the reasons behind each step and a
troubleshooting section at the end.

Two processes plus one database:

| Piece | Where | Runs on |
|---|---|---|
| Django API (`backend/`) | Python 3.12 + PostgreSQL | `http://localhost:8000` |
| Next.js UI (`frontend/`) | Node.js | `http://localhost:3000` |
| PostgreSQL | Docker (easiest) or any Postgres ≥14 | `localhost:5432` |

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | **3.12** | Pinned in `backend/.python-version`, `pyproject.toml` (`target-version = "py312"`) and CI. Newer 3.x versions generally work but are not what CI tests. |
| Node.js + npm | **20.9 or newer** (CI uses 26) | Next.js 16's own minimum is `>=20.9.0`. |
| PostgreSQL | **14+** (CI and the deployment use 16) | Must be real Postgres — the double-booking guard relies on `SELECT … FOR UPDATE` and on the `btree_gist` extension, neither of which SQLite has. |
| Docker | any recent | Optional; the quickest way to get Postgres. |
| Git | any | |
| k6 | any recent | Optional; only for the load-test scripts in `k6/`. |

There is no Dockerfile or `docker-compose.yml` in the repo — the app runs
natively on your machine and only the database is containerised.

## 2. Get the code

```bash
git clone <repo-url> AEA
cd AEA
```

Repository layout (see [`development.md`](development.md) for detail):

```
.env.example        ← template for both backend and frontend env vars
backend/            ← Django project (config/, accounts/, scheduling/, bookings/, audit/, reminders/, core/)
frontend/           ← Next.js app (app/, components/, hooks/, lib/, proxy.ts)
k6/                 ← load-test scripts
docs/               ← this folder
```

## 3. Start PostgreSQL

### Option A — Docker (recommended)

```bash
docker run -d --name aea-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:16-alpine
```

This matches the default `DATABASE_URL` in `.env.example`
(`postgresql://postgres:postgres@localhost:5432/postgres`) so nothing else
needs configuring. `docker start aea-postgres` brings it back after a
reboot.

### Option B — a Postgres you already have

Create a database and a user that **owns it** (or is a superuser). The
`bookings` migration `0005_no_overlapping_active_bookings` runs
`CREATE EXTENSION IF NOT EXISTS btree_gist`, which needs that privilege
(Postgres ≥13 lets the database owner create trusted extensions; on older
servers, or if you get a "permission denied to create extension" error, run
`CREATE EXTENSION btree_gist;` once as a superuser and re-run `migrate`).
Then set `DATABASE_URL` in `.env` accordingly.

### Option C — hosted Postgres (Supabase, Railway, Neon…)

Paste the connection string they give you into `DATABASE_URL` and append
`?sslmode=require` — the query string is passed straight through to
psycopg. `btree_gist` is available on all three.

## 4. Configure environment variables

```bash
cp .env.example .env                    # backend reads this (repo root or backend/.env)
cp .env.example frontend/.env.local     # frontend only reads NEXT_PUBLIC_API_URL from it
```

The defaults work as-is against the Docker Postgres above; you do not need a
Resend key, a Supabase project, or any secret to run locally. How the
backend loads them: `backend/config/settings.py` reads `<repo>/.env` and then
`backend/.env` (plain `KEY=VALUE`, no third-party dotenv package); real
environment variables always win over the file. Next.js reads
`frontend/.env.local` natively.

### Environment variables

| Variable | Read by | Default if unset | Purpose |
|---|---|---|---|
| `DATABASE_URL` | backend | `postgresql://postgres:postgres@localhost:5432/postgres` | Postgres connection string. Query params (e.g. `?sslmode=require`) pass through to psycopg. |
| `DJANGO_SECRET_KEY` | backend | insecure dev key | Django signing key. **Outside `DJANGO_DEBUG=True` the app refuses to start** if this is left at the checked-in dev fallback. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(50))"`. |
| `DJANGO_DEBUG` | backend | `False` | `True` for local dev: debug pages, `LocMemCache`, non-`Secure` cookies, browsable API, `/admin/` mounted. `.env.example` sets `True`. |
| `DJANGO_ALLOWED_HOSTS` | backend | `localhost,127.0.0.1` | Comma-separated hostnames Django will serve. |
| `CORS_ALLOWED_ORIGINS` | backend | `http://localhost:3000` | Exact origins (scheme+host+port, no path) allowed to call the API with credentials — the frontend's origin. Add another entry if `next dev` ends up on a different port. |
| `JWT_SECRET_KEY` | backend | falls back to `DJANGO_SECRET_KEY` | Separate signing key for auth JWTs, so the two secrets can be rotated independently. |
| `TEST_DB_NAME_SUFFIX` | backend (tests only) | empty | Suffix for the test database name so two `manage.py test` runs can share one Postgres. |
| `RESEND_API_KEY` | backend | empty | Resend API key for reminder and cancellation emails. **Unset is a supported state**: sends are logged and skipped, never errors. |
| `RESEND_FROM_EMAIL` | backend | `reminders@example.com` | "From" address; must be a verified domain in Resend for a real send. |
| `FRONTEND_BASE_URL` | backend | `http://localhost:3000` | Portal link embedded in reminder emails and cancellation email/SMS. |
| `LOG_FORMAT` | backend | `text` in debug, `json` otherwise | Override log line format. |
| `NEXT_PUBLIC_API_URL` | frontend (browser) | `http://localhost:8000` | API origin the browser calls. On Railway this is the *frontend's own* origin (see [`deployment.md`](deployment.md)). |
| `BACKEND_URL` / `RAILWAY_SERVICE_BACKEND_URL` | frontend (server) | unset | Rewrite target for the Next.js proxy routes. Leave unset locally — with neither set, no rewrites are installed and the browser talks to Django directly. |

## 5. Backend

All commands from `backend/`.

**Git Bash / macOS / Linux**

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate        # Windows Git Bash
# source .venv/bin/activate          # macOS / Linux
pip install -r requirements.lock
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000
```

**Windows PowerShell**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1         # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.lock
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000
```

What each step does:

- `pip install -r requirements.lock` — installs the exact versions CI installs (Django 6.1, DRF 3.18, SimpleJWT 5.5, psycopg 3 binary, gunicorn, bcrypt, ruff, coverage). `requirements.txt` (runtime) and `requirements-dev.txt` (adds ruff + coverage) are the ranged, human-edited sources; the lock is generated from them — see [`development.md`](development.md#dependencies) before editing either.
- `migrate` — creates every table, the audit-log append-only trigger, the `btree_gist` extension and the booking exclusion constraints.
- `seed_demo` — creates 15 providers, 25 patients and 1 admin (password `demo-password-not-for-prod`, all on `America/Chicago`), each provider's working hours and appointment types, ~305 pre-existing bookings across a 133-day horizon plus a 100-booking weekly cohort. Idempotent: re-running adds nothing on the same day (on a later day it extends the horizon). It does **not** reset passwords of accounts that already exist. It goes through the real booking service for every seeded booking, so expect it to run for a little while and print a summary at the end. Full account list in [`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md).
- `runserver 0.0.0.0:8000` — Django's dev server. `0.0.0.0` only matters if you want to reach it from another device; `localhost:8000` is fine.

Verify:

```bash
curl http://localhost:8000/health
# {"status": "ok", "database": "reachable"}
```

A `503 {"status":"degraded","database":"unreachable"}` means Django is up but
cannot reach Postgres — check `DATABASE_URL` and that the container is
running.

Optional: `python manage.py createsuperuser` is **not** needed — the seeded
`admin@demo.aea.test` is a full admin, and the Django `/admin/` UI is only
mounted when `DJANGO_DEBUG=True` (it is where provider/admin accounts are
created, since self-registration always creates a patient).

## 6. Frontend

```bash
cd frontend
npm install          # or `npm ci` for the exact lockfile versions CI uses
npm run dev
```

Open <http://localhost:3000>. If 3000 is busy Next picks the next free port
and prints it — if that happens, add that origin to `CORS_ALLOWED_ORIGINS`
in `.env` and restart the backend, otherwise login will fail with a CORS
error in the browser console.

`npm run dev` also (re)writes `frontend/AGENTS.md`; that is Next.js
behaviour, not something to fix.

## 7. Log in

Go to <http://localhost:3000/login> and use any seeded account with password
`demo-password-not-for-prod`:

| Role | Email | Lands on |
|---|---|---|
| Patient | `patient@demo.aea.test` (also `patient2`…`patient25`) | `/patient` — your calendar; `/patient/book` to book, `/patient/appointments` to manage |
| Provider | `provider1@demo.aea.test` … `provider15@demo.aea.test` | `/provider/calendar` — agenda; `/provider` — availability settings |
| Admin | `admin@demo.aea.test` | `/admin` — audit-log viewer |

Or register a new account on the same page — registration always creates a
**patient**. Password rules are Django's defaults: ≥8 characters, not
entirely numeric, not a common password, not too similar to your email/name.

What to click through first is in [`features.md`](features.md).

## 8. Run the tests

Backend (needs Postgres running; the suite creates and drops its own
`test_postgres` database):

```bash
cd backend
python manage.py test                              # whole suite
python manage.py test bookings.tests.test_concurrency -v 2   # the 10-thread double-booking race
coverage run manage.py test && coverage report     # with the ≥80% gate CI enforces
ruff check .                                       # lint, also run by CI
```

If your `.env` has `DJANGO_DEBUG=False`, `DJANGO_SECRET_KEY` must be set to
something other than the dev default or the test run will refuse to start
(that is the production safety check doing its job — CI sets one).

Frontend:

```bash
cd frontend
npm test              # Vitest, single run
npm run typecheck     # next typegen && tsc --noEmit
npm run lint          # eslint, fails on any warning
npm run test:watch    # watch mode while developing
```

Both blocks are exactly what `.github/workflows/ci.yml` runs on every push.

## 9. Load tests (optional)

Install [k6](https://k6.io/docs/get-started/installation/), have the backend
running and seeded, then from the repo root:

```bash
k6 run k6/slot-availability.js
k6 run k6/booking-action.js
```

Defaults: `BASE_URL=http://localhost:8000`, `VUS=30`, `DURATION=60s`,
overridable with `-e`. `booking-action.js` creates real bookings for the
demo patient — run it against a local database, not the shared deployment.
Methodology and recorded results: [`k6/README.md`](../k6/README.md).

## 10. Production-style run (optional)

To run the same way Railway does — gunicorn, `DEBUG=False`, secure cookies —
you need HTTPS in front (Django will redirect plain HTTP to HTTPS via
`SECURE_SSL_REDIRECT`), so this is rarely useful on a laptop; the settings
are covered in [`deployment.md`](deployment.md). The pieces, for reference:

```bash
# backend
DJANGO_DEBUG=False DJANGO_SECRET_KEY=<real> python manage.py migrate --noinput
python manage.py createcachetable          # DatabaseCache table for throttles/lockout
gunicorn config.wsgi:application --bind 0.0.0.0:8000
# frontend
npm run build && npm run start
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ImproperlyConfigured: DJANGO_SECRET_KEY must be set to a real value outside local development.` | `DJANGO_DEBUG` is not `True` and the secret is the dev default. Either set `DJANGO_DEBUG=True` in `.env` for local work, or set a real `DJANGO_SECRET_KEY`. |
| `psycopg.OperationalError: connection refused` / `/health` returns 503 | Postgres is not running or `DATABASE_URL` is wrong. `docker ps` / `docker start aea-postgres`. |
| `permission denied to create extension "btree_gist"` during `migrate` | Your DB user cannot create extensions (Option B above). Run `CREATE EXTENSION btree_gist;` as a superuser on that database, then `migrate` again. |
| Login page: network/CORS error in the console; API returns no cookie | Frontend origin isn't in `CORS_ALLOWED_ORIGINS` (e.g. Next moved to port 3001), or `NEXT_PUBLIC_API_URL` doesn't point at `http://localhost:8000`. Fix `.env`, restart the backend. |
| `403 {"detail": "..."}` on every POST from a script/curl | Every unsafe-method request must send `X-Requested-With: XMLHttpRequest` (CSRF mitigation for cookie auth). See [`api.md`](api.md#authentication). |
| `429 Too Many Requests` on login | 5 logins/min per IP, and 10 failed attempts per account locks it for 15 min. Wait, or restart the backend when `DJANGO_DEBUG=True` (the counters live in in-process `LocMemCache` there). |
| Provider shows "not bookable" / no slots | The provider has no working hours yet, or you're outside the ≤60-day slot query window; check `/provider` → Availability settings, or pick a seeded provider. |
| Slots or calendar look shifted by an hour | The provider/patient timezone in Settings vs. your machine's — everything is stored in UTC and rendered in the account's timezone (seed accounts are `America/Chicago`). |
| `python manage.py test` fails with "database already exists" | A previous run was interrupted. Re-run with `--noinput`, or set `TEST_DB_NAME_SUFFIX` to use a fresh name. |
| `Activate.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then re-activate. |
| Frontend `typecheck` fails on a clean checkout about missing route types | Run `npm run typecheck` (it runs `next typegen` first) rather than bare `tsc`; or `npm run dev` once. |
| Reminder / cancellation emails never arrive | Expected: `RESEND_API_KEY` is unset, so sends are logged as a warning and skipped. Set a real key and a verified `RESEND_FROM_EMAIL` to send. |
| Windows: `runserver` drops connections under k6 load | Known dev-server limitation; use gunicorn (WSL) or Waitress for local load tests, as described in `k6/README.md`. |
