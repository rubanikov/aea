# Deployment guide (Railway)

How the live instance is put together and how to reproduce it. The app is
deployed on Railway, project **`aea-scheduling-portal`**, as four services:

| Service | Source dir | Builder | What it runs |
|---|---|---|---|
| `backend` | `backend/` | Nixpacks ([`backend/railway.json`](../backend/railway.json)) | `python manage.py migrate --noinput && python manage.py createcachetable && gunicorn config.wsgi:application --bind 0.0.0.0:$PORT` |
| `frontend` | `frontend/` | Railpack (zero-config; no `railway.json` in `frontend/`) | `next build` / `next start` autodetected |
| `Postgres` | — | Railway managed Postgres | database, reached over the private network |
| `reminders-cron` | `backend/` | Railpack ([`backend/railway.cron.json`](../backend/railway.cron.json)) | `python manage.py dispatch_reminders` every 15 min (`*/15 * * * *`), restart policy `NEVER` |

Live URLs (as of 2026-08-15):
frontend <https://frontend-production-9ca8.up.railway.app>,
backend <https://backend-production-e1121.up.railway.app>,
health <https://backend-production-e1121.up.railway.app/health>.

There is no GitHub integration: deploys are **CLI uploads** from a local
checkout. Nothing about the app is Railway-specific beyond the two config
files above; any host that can run gunicorn, `next start` and Postgres works
(the original design assumed Vercel for the frontend — see
`architecture.md` §1 for why both ended up on Railway).

## Why the frontend proxies the API

`*.up.railway.app` is a public suffix, so `frontend-….up.railway.app` and
`backend-….up.railway.app` are different **sites**. The auth cookies are
`SameSite=Strict`, so a browser on the frontend origin would never send them
to the backend origin. The fix is that the browser only ever talks to the
frontend origin: `NEXT_PUBLIC_API_URL` is set to the frontend's own URL, and
`next.config.ts` installs rewrites (`/auth/*`, `/profile*`, `/bookings*`,
`/scheduling/*`, `/audit-log`) that forward to `BACKEND_URL` server-side
(`frontend/lib/api/proxy-rewrites.ts`, `lib/api/backend-origin.ts`).
`proxy.ts` uses the same origin for its server-side `GET /auth/me`.

The rewrite target is the backend's **public** HTTPS origin (Railway edge →
backend), not `backend.railway.internal`; that keeps TLS end-to-end without
configuring anything on the private network. Locally neither
`BACKEND_URL` nor `RAILWAY_SERVICE_BACKEND_URL` is set, so no rewrites are
installed and the browser calls Django on `:8000` directly (cookies are
host-only on `localhost`, so port differences don't matter).

## Environment variables per service

Set these in the Railway dashboard or with `railway variables --set`. Never
commit real values.

**backend**

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable → `postgresql://…@postgres.railway.internal:5432/railway`; private network, so no `?sslmode=require` is needed. If you point at a *public* Postgres host, append it.) |
| `DJANGO_SECRET_KEY` | long random string (`python -c "import secrets; print(secrets.token_urlsafe(50))"`). The app refuses to boot without one when `DJANGO_DEBUG` is not `True`. |
| `JWT_SECRET_KEY` | a second, different random string |
| `DJANGO_DEBUG` | `False` |
| `DJANGO_ALLOWED_HOSTS` | the backend's public hostname, e.g. `backend-production-e1121.up.railway.app` |
| `CORS_ALLOWED_ORIGINS` | the frontend's origin, e.g. `https://frontend-production-9ca8.up.railway.app` (still needed for the server-side `proxy.ts` call and any direct browser call) |
| `FRONTEND_BASE_URL` | the frontend origin (link target inside reminder / cancellation messages) |
| `RESEND_FROM_EMAIL` | a sender on a domain verified in Resend |
| `RESEND_API_KEY` | **left unset on the demo deployment on purpose** — sends are logged and skipped. Set it to actually send email/SMS. |
| `LOG_FORMAT` | optional; defaults to `json` outside debug |
| `PORT` | injected by Railway; gunicorn binds to it |

**frontend**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | the **frontend's own** origin (see above) |
| `BACKEND_URL` | the backend's public origin, `https://backend-….up.railway.app` |
| `RAILWAY_SERVICE_BACKEND_URL` | injected by Railway (hostname only); used as `https://<host>` fallback when `BACKEND_URL` is unset |

**reminders-cron** — same as the backend, referenced rather than copied:
`DATABASE_URL=${{Postgres.DATABASE_URL}}`,
`DJANGO_SECRET_KEY=${{backend.DJANGO_SECRET_KEY}}`,
`DJANGO_ALLOWED_HOSTS=${{backend.DJANGO_ALLOWED_HOSTS}}`,
`FRONTEND_BASE_URL=${{backend.FRONTEND_BASE_URL}}`,
`RESEND_FROM_EMAIL=${{backend.RESEND_FROM_EMAIL}}`, `DJANGO_DEBUG=False`, plus
`RESEND_API_KEY` once a real key exists. It has no public networking.

What `DJANGO_DEBUG=False` switches on (`backend/config/settings.py`): secure
cookies, `SECURE_SSL_REDIRECT`, HSTS (1 year, include subdomains), JSON-only
renderer, JSON log lines, `DatabaseCache` for throttles/lockout, and the
Django `/admin/` site is **not** mounted.

## First-time provisioning

Prerequisites: [Railway CLI](https://docs.railway.com/guides/cli) ≥ 5,
`railway login`.

```bash
# from the repo root
railway init --name aea-scheduling-portal        # or `railway link` to an existing project
railway add --database postgres

railway add --service backend
railway variables --service backend \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "DJANGO_SECRET_KEY=$(python -c 'import secrets;print(secrets.token_urlsafe(50))')" \
  --set "JWT_SECRET_KEY=$(python -c 'import secrets;print(secrets.token_urlsafe(50))')" \
  --set DJANGO_DEBUG=False --set RESEND_FROM_EMAIL=reminders@example.com
railway up backend --path-as-root -s backend -d      # first deploy; then generate a domain
railway domain -s backend                            # prints https://backend-….up.railway.app

railway add --service frontend
railway domain -s frontend                           # prints https://frontend-….up.railway.app
# now that both hostnames are known:
railway variables --service backend \
  --set DJANGO_ALLOWED_HOSTS=<backend host> \
  --set CORS_ALLOWED_ORIGINS=https://<frontend host> \
  --set FRONTEND_BASE_URL=https://<frontend host>
railway variables --service frontend \
  --set NEXT_PUBLIC_API_URL=https://<frontend host> \
  --set BACKEND_URL=https://<backend host>
railway up backend  --path-as-root -s backend  -d
railway up frontend --path-as-root -s frontend -d
```

The reminder cron is a fourth service deployed from the same `backend/`
directory with `railway.cron.json` selected as its config file — the exact
commands are in
[`backend/reminders/README.md`](../backend/reminders/README.md#railway-cron-configuration).

**`--path-as-root` matters.** The CLI archives the *project* directory
unless told otherwise; running `railway up -s backend` from inside
`backend/` still uploads the git root, `backend/railway.json` is not found,
Railpack autodetects at the repo root and the build fails. Always
`railway up <dir> --path-as-root -s <service>` from the repo root.

## Redeploying after a change

```bash
railway up backend  --path-as-root -s backend  -d
railway up frontend --path-as-root -s frontend -d
railway deployment list --service backend --json     # wait for SUCCESS
curl https://<backend host>/health                   # {"status":"ok","database":"reachable"}
```

Migrations run automatically at backend start (`railway.json` start
command), so a schema change needs no extra step. `createcachetable` in the
same command is idempotent.

## Seeding the deployed database

`seed_demo` is idempotent and safe to run against production; it is how the
live demo data got there:

```bash
railway run -s backend python manage.py seed_demo      # runs locally with the service's env vars
# or open a shell on the service: railway ssh -s backend, then python manage.py seed_demo
```

Afterwards, **rotate the deployed admin password** — the seed password is
public in this repo and admin can read every booking and the whole audit
log:

```bash
railway run -s backend python manage.py shell -c \
  "from accounts.models import User; u=User.objects.get(email='admin@demo.aea.test'); u.set_password('<new>'); u.save()"
```

Keep the new password out of the repo (`*.local.md` is git-ignored for
exactly this).

## Operations

- **Logs**: `railway logs -s backend` (or the dashboard). Outside debug every
  line is one JSON object (`core/logging.py`) with `timestamp`, `level`,
  `logger`, `message` and, for request logs, `status_code`; no PHI — only IDs.
- **Health**: `GET /health` checks the DB. Railway's own health-check path
  can be pointed at it in the service settings.
- **Cron**: `railway logs -s reminders-cron` shows each run's
  `DispatchSummary(considered, sent, skipped, failed, already_logged)`. With
  no `RESEND_API_KEY`, `skipped` counts every due reminder.
- **Throttling & lockout state** lives in the `django_cache` table; clearing
  a lockout early is `DELETE FROM django_cache WHERE cache_key LIKE '%login-lockout:%'`
  (Django prefixes the key with its version/prefix, hence the wildcard) or
  simply waiting 15 min.
- **TLS**: terminated at Railway's edge for both services; the app enforces
  HTTPS via `SECURE_SSL_REDIRECT`/HSTS and `Secure` cookies. Postgres at rest
  is encrypted by Railway's managed service. No BAA is in place with Railway
  or Resend — see the README's PHI notes.
- **Rollback**: `railway deployment list` → `railway redeploy <id>` from the
  dashboard, or re-upload the previous commit. Migrations are forward-only;
  none so far are destructive.

## Deploying elsewhere

- **Backend anywhere gunicorn runs** (Render, Fly, a VM): install
  `requirements.txt`, set the same env vars, run the same start command
  behind TLS. Postgres needs the `btree_gist` extension available (all
  managed providers have it).
- **Frontend on Vercel**: works unchanged; set `NEXT_PUBLIC_API_URL` to the
  Vercel origin and `BACKEND_URL` to the backend origin so the rewrites are
  installed. If frontend and backend share a registrable domain
  (`app.example.com` / `api.example.com`) the rewrites are unnecessary —
  `SameSite=Strict` cookies work across subdomains of one site — and
  `NEXT_PUBLIC_API_URL` can point straight at the API.
- **Cron**: any scheduler that can run `python manage.py dispatch_reminders`
  every 15–30 min with the backend's env vars. Overlapping runs are safe
  (`ReminderLog` unique constraint).
