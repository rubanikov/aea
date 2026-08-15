# Development guide

How the codebase is organised, the conventions it follows, and the loop for
making a change. Setup itself is in [`installation.md`](installation.md);
the endpoint contract is in [`api.md`](api.md); design rationale is in
[`architecture.md`](../architecture.md).

## Repository layout

```
.env.example              template for every env var (backend + frontend)
.github/workflows/ci.yml  CI: backend (ruff, tests + coverage gate) and frontend (lint, typecheck, tests)
README.md                 grader quick-start and PHI/security summary
architecture.md           design decisions + "as built" notes
project.md                the original brief
tickets/                  the 14 build tickets and what came after
docs/                     installation, api, deployment, development, features
backend/                  Django 6.1 / DRF 3.18 project (Python 3.12)
frontend/                 Next.js 16 / React 19 app (TypeScript, Tailwind 4, Vitest)
k6/                       load-test scripts + recorded results
audits/                   security/quality audit write-ups
```

### Backend (`backend/`)

One Django project (`config/`) and six apps. Each app keeps the same shape:
`models.py`, `serializers.py`, `views.py` (thin), a **services** layer that
owns the rules, `urls.py`, `tests/`.

| App | Owns | Notable modules |
|---|---|---|
| `core` | cross-cutting plumbing | `middleware.py` (64 KB body cap, `no-store`), `exceptions.py` (JSON-only errors), `logging.py` (JSON formatter), `views.py` (`/health`), `management/commands/seed_demo.py` |
| `accounts` | `User`, auth, profile, deletion | `authentication.py` (cookie JWT), `tokens.py` (cookie set/clear, refresh rotation + reuse detection), `csrf.py` (`X-Requested-With`), `lockout.py`, `services.py` (`delete_account`), `permissions.py` (`HasRole`) |
| `scheduling` | availability, appointment types, blocked time, slot computation | `schedule.py` (generations, weekly-window validation), `slots.py` (`get_open_slots`, 60-day cap), `collisions.py` (133-day scan), `services.py` (`apply_schedule_change`) |
| `bookings` | bookings, status lifecycle, notifications | `services.py` (`create_booking`, `reschedule_booking`, the row-lock guard), `transitions.py` (`transition()`, 24 h rule), `notifications.py` (cancellation email/SMS), `exceptions.py`, `permissions.py` |
| `audit` | append-only audit log | `models.py` (ORM guards), `services.py` (`record_audit_event`), `ownership.py` + `permissions.py` (`IsOwnerOrAdmin`, admin-bypass logging), `pagination.py` |
| `reminders` | 24 h reminder cron | `services.py` (`dispatch_due_reminders`), `emails.py`, `management/commands/dispatch_reminders.py`, its own `README.md` |

`config/settings.py` is heavily commented and is the reference for every
env var, throttle rate, cookie flag and cache choice. `config/urls.py`
mounts every app at the root (no `/api` prefix) and mounts Django's
`/admin/` only in debug/tests.

### Frontend (`frontend/`)

| Path | What |
|---|---|
| `app/` | App Router routes (see the route table in [`frontend/README.md`](../frontend/README.md)); `layout.tsx`, `error.tsx`, `global-error.tsx`, `globals.css` (design tokens, OKLCH) |
| `proxy.ts` | Next 16's request interceptor (successor to `middleware.ts`): server-side role gate for `/patient/*`, `/provider/*`, `/admin/*`, `/settings/*` |
| `components/` | by feature: `auth`, `availability`, `booking` (wizard), `bookings` (lists, calendars, cancel/reschedule), `calendar` (week grid primitives), `audit`, `settings`, `nav`, `theme`, `forms`, `ui` (shadcn-style primitives on `radix-ui`) |
| `hooks/` | `use-current-user`, `use-authenticated-request` (401 → session-expired redirect), `use-focus-trap`, provider data hooks |
| `lib/` | pure logic, all unit-tested: `api/` (fetch client, field-error mapping, backend origin, rewrites), `auth/` (route guard, login flow, validation), `availability/` (generations, validation, durations), `bookings/`, `calendar/`, `scheduling/`, `theme/`, `timezones.ts`, `nav-config.ts` |
| root tests | `a11y.test.tsx` (axe over key components), `theme-contrast.test.ts`, `token-migration.test.ts`, `proxy.test.ts` |

`lib/api/client.ts` is the single place that talks to the backend: always
`credentials: "include"`, adds `X-Requested-With: XMLHttpRequest` on unsafe
methods, and maps DRF field errors for the forms.

## Conventions the code relies on

These are stated in docstrings throughout the backend; breaking them tends
to break a test.

1. **One write path per concept.** Booking creation goes through
   `bookings.services.create_booking`; every status change through
   `bookings.transitions.transition()`; every schedule change through
   `scheduling.services.apply_schedule_change`; every audit row through
   `audit.services.record_audit_event`; every reminder through
   `reminders.services.dispatch_due_reminders`. Add behaviour *inside* these,
   don't add a second path around them.
2. **Views are thin.** They validate with a serializer, call a service, and
   map typed exceptions (`bookings/exceptions.py`, `scheduling` service
   errors) to status codes. Business rules never live in a view.
3. **Server owns the sensitive fields.** `patient`, `provider`, `end_time`,
   `role`, `effective_from` on writes are set from `request.user` or derived,
   never accepted from the client.
4. **Ownership is checked in the app layer, on every PHI-touching view.**
   List/create views compare `request.user.role` and force the owner field;
   detail views use `IsOwnerOrAdmin` / `IsBookingProviderOrAdmin` and must call
   `check_object_permissions()`. A wrong owner gets `403`, not `404`. Admin
   bypasses are allowed and always audited.
5. **Audit rows are synchronous and in-transaction** so a domain write and
   its audit row commit or roll back together. `metadata` and `target_id`
   hold IDs / roles / status values only — never names, emails or free text.
   The `AuditLog` table cannot be updated or deleted (ORM guard + DB
   trigger); to backdate one in a test, mock `django.utils.timezone.now` at
   creation time.
6. **No PHI in logs**, cache keys or exception messages. Log IDs; the login
   lockout fingerprints emails with SHA-256 before using them as keys.
7. **Postgres only.** `select_for_update`, `ExclusionConstraint`,
   `btree_gist` and the audit trigger have no SQLite equivalent; there is no
   SQLite fallback and there must not be one.
8. **Import-time vs runtime `DEBUG`.** `manage.py test` forces runtime
   `DEBUG=False`, but settings computed at import (`SECURE_HSTS_SECONDS`,
   `CACHES`, `LOG_FORMAT`) follow the ambient `DJANGO_DEBUG` — pin them with
   `override_settings` in tests instead of trusting the environment.
9. **Frontend never stores tokens.** Cookies are httpOnly; the only
   `localStorage` key is the theme preference. `proxy.ts` gates routes;
   `useCurrentUser` is display-only.
10. **Every new secret goes in `.env.example`** with a comment, and every
    new env var read in `settings.py` is documented in
    [`installation.md`](installation.md#environment-variables).

## Day-to-day loop

```bash
# backend
cd backend && source .venv/Scripts/activate      # .venv/bin/activate on macOS/Linux
python manage.py runserver 0.0.0.0:8000
python manage.py test <app>[.tests.<module>[.<Class>[.<test>]]] -v 2
ruff check .                                     # what CI runs (rules E, F, I, W; line length 100)
coverage run manage.py test && coverage report   # fail_under = 80 (pyproject.toml)

# frontend
cd frontend && npm run dev
npm run test:watch                                # or `npm test` once
npm run typecheck && npm run lint
```

### Tests

- Backend: 58 test modules under `backend/*/tests/`, run by Django's
  runner against a throwaway `test_<dbname>` Postgres database. Two suites
  are `TransactionTestCase`s that use real threads and separate connections
  and should be run on their own when debugging:
  `bookings.tests.test_concurrency` (10 threads on the last open slot →
  exactly one `201`) and `reminders.tests.test_concurrency`. Set
  `TEST_DB_NAME_SUFFIX` to run two suites against one Postgres at once.
- Frontend: Vitest + Testing Library in jsdom (`vitest.config.mts`,
  `vitest.setup.ts`); components have co-located `*.test.tsx`; pure logic in
  `lib/` has `*.test.ts`. `a11y.test.tsx` runs axe with `color-contrast` and
  `region` disabled (contrast is covered by `theme-contrast.test.ts`;
  components render without page landmarks) — add a case there for any new
  major user-facing component. There is no frontend coverage gate.
- Coverage numbers quoted in the README (98 % backend, 100 % on the core
  modules) come from `coverage report`; the gate is scoped to `backend/`
  and omits migrations, tests, `manage.py`, `asgi.py`/`wsgi.py`.

### Migrations

`python manage.py makemigrations <app>` then commit the file. Non-schema
migrations that already exist and are worth knowing about:
`audit/0002_append_only_trigger.py` (raw SQL trigger),
`bookings/0005_no_overlapping_active_bookings.py` (`BtreeGistExtension` +
exclusion constraints — needs `CREATE EXTENSION` privilege on the DB).
The `django_cache` table is **not** a migration; it is created by
`manage.py createcachetable` (part of the Railway start command) and is only
used when `DEBUG` is off.

### Dependencies

Backend: edit the ranged files (`requirements.txt` runtime,
`requirements-dev.txt` adds ruff/coverage), then regenerate the lock the
way its header describes:

```bash
python -m venv /tmp/lockenv && . /tmp/lockenv/bin/activate
pip install -r requirements-dev.txt && pip freeze > requirements.lock   # then re-add the header comment
```

CI and the README install from `requirements.lock`; Railway's Nixpacks build
installs `requirements.txt`. Frontend: `npm install <pkg>` updates
`package-lock.json`; CI uses `npm ci`.

### Adding an endpoint (checklist)

1. Serializer with explicit `fields` / `read_only_fields`; never expose
   server-owned fields as writable.
2. Service function with the rule and its typed exceptions; unit tests
   for the failure paths first.
3. Thin view: permission class or explicit role check, `check_object_permissions()`
   for detail views, exception → status mapping, `record_audit_event` for
   anything that reads or writes PHI.
4. URL in the app's `urls.py`; if the browser must reach it on Railway, add
   its path family to `frontend/lib/api/proxy-rewrites.ts` (and its test).
5. Document it in [`api.md`](api.md).

### Seeding & demo data

`python manage.py seed_demo` is idempotent (natural keys + per-slot
idempotency keys); it does not reset existing passwords. Its docstring holds
the slot arithmetic the k6 benchmark and `core/tests/test_seed_demo.py`
depend on (`EXPECTED_GROSS_SLOT_TOTAL = 16,150` over 133 days) — change the
provider configs and that test together.

## CI

`.github/workflows/ci.yml`, on every push and PR:

| Job | Steps |
|---|---|
| Backend (Django) | Postgres 16 service; Python 3.12; `pip install -r requirements.lock`; `ruff check .`; `coverage run manage.py test && coverage report` with `DJANGO_DEBUG=False` and a CI secret key |
| Frontend (Next.js) | Node 26; `npm ci`; `npm run lint`; `npm run typecheck`; `npm test` |

`npm run build` is not part of CI; run it locally before a frontend deploy
if you touched server/client component boundaries.

## Branching

`master` is what gets deployed and graded. Feature work happens on
`feature/<name>` branches and is merged when CI is green. Planning
artifacts for post-slate features (technical briefs, ticket slices) are
committed under `.scratch/<feature>/`; the original 14 tickets are in
`tickets/`.
