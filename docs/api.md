# HTTP API reference

The Django backend exposes a JSON API at the origin in `NEXT_PUBLIC_API_URL`
(`http://localhost:8000` locally). Every path below is relative to that
origin; there is no `/api` prefix. Source of truth is the code — file
references are given so each claim can be checked (`backend/…`).

Contents: [Conventions](#conventions) · [Authentication](#authentication) ·
[Accounts & profile](#accounts--profile) · [Scheduling](#scheduling) ·
[Bookings](#bookings) · [Audit log](#audit-log) · [Health](#health) ·
[Management commands](#management-commands)

## Conventions

- **Auth**: an httpOnly `access_token` cookie (see below). No `Authorization`
  header. Default permission is `IsAuthenticated`; endpoints marked *public*
  override it.
- **CSRF**: every unsafe-method request (`POST`, `PUT`, `PATCH`, `DELETE`)
  must carry the header `X-Requested-With: XMLHttpRequest`, otherwise `403`
  (`accounts/csrf.py`). Cookies are `SameSite=Strict`, so this header is the
  second half of the CSRF defence.
- **Bodies**: JSON in, JSON out. Request bodies over **64 KB** are rejected
  with a JSON `413` before parsing (`core/middleware.py`).
- **Timestamps**: ISO 8601 with offset; every stored instant is UTC. Dates
  (`date_from`, `effective_from`…) are `YYYY-MM-DD`.
- **Errors**: HTTP status + `{"detail": "…"}` or field-keyed
  `{"field": ["…"]}`; there is no separate machine-readable error-code
  field. `400` bad input or illegal domain transition; `401` not logged in;
  `403` wrong role/owner or missing CSRF header (existence of the row is not
  hidden — a wrong owner gets 403, not 404); `404` no such row; `409` a real
  conflict (lost race, collision); `413` oversized body; `429` throttled;
  `503` database unreachable; `500` `{"detail":"An unexpected error occurred."}`
  — never an HTML error page (`core/exceptions.py`).
- **Throttling** (`config/settings.py`): `anon` 100/min, `user` 300/min,
  `login` 5/min per IP, `booking_cancel` 10/min per account. Counters live
  in a Postgres-backed cache outside debug so they hold across workers.
- **Caching**: every response carries `Cache-Control: no-store` and
  `Vary: Cookie` unless the view set its own.
- **Audit**: side effects marked ✎ write an `AuditLog` row (`actor`,
  `action`, `target_type`, `target_id`, `metadata` — IDs/roles/statuses only,
  never names or free text).
- **Roles**: `patient`, `provider`, `admin` on `User.role`. Ownership is
  enforced server-side on every PHI-touching view; an admin may bypass
  ownership checks, and every bypass is audited as
  `admin_bypass:<action>:<target_type>`.

## Authentication

`accounts/tokens.py`, `accounts/authentication.py`, `accounts/views.py`.

| Cookie | Lifetime | Path | Flags |
|---|---|---|---|
| `access_token` | 15 min | `/` | `HttpOnly`, `Secure` (outside debug), `SameSite=Strict` |
| `refresh_token` | 7 days | `/auth` | same |

Flow: `POST /auth/login` (or `/auth/register`) sets both cookies. The
frontend calls the API with `credentials: "include"`. When the access token
expires, `POST /auth/refresh` (no access cookie required) rotates the
refresh token and sets a new pair. A rotated-out refresh token replayed
within a **10 s grace window** receives the pair already issued (multi-tab
race); replayed later it is treated as **reuse**: `401`, every outstanding
refresh token for the account is revoked, and cookies are cleared. Changing
the password rotates the current session and invalidates every other
session's access tokens (`CHECK_REVOKE_TOKEN`). Passwords are hashed with
bcrypt.

Login protection: 5 attempts/min per IP (`login` throttle) **and** a
per-account lockout after 10 failed attempts within 15 min (`accounts/lockout.py`;
`429`, detail "Too many failed login attempts…"). Failures never reveal
whether the email exists (`400`, `"Invalid email or password."`).

`curl` example (note the cookie jar and the CSRF header):

```bash
curl -c jar -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"email":"patient@demo.aea.test","password":"demo-password-not-for-prod"}' \
  http://localhost:8000/auth/login
curl -b jar http://localhost:8000/auth/me
```

## Accounts & profile

`accounts/views.py`, `accounts/serializers.py`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /auth/register` | public | Create a **patient** account and log in. |
| `POST /auth/login` | public | Log in. |
| `POST /auth/logout` | any authenticated | Blacklist refresh token, clear cookies. |
| `POST /auth/refresh` | refresh cookie | Rotate tokens (see above). |
| `GET /auth/me` | any authenticated | Current user. |
| `GET` / `PATCH /profile` | any authenticated | Read / update own profile. |
| `POST /profile/password` | any authenticated | Change password. |
| `POST /profile/delete-account` | any authenticated | Scrub own account. |

**User object** (returned by register/login/me/profile):
`{id, email, name, role, phone, timezone, sms_carrier}`. `id` and `role`
are read-only — role is never self-service; provider and admin accounts are
created in the Django admin (`/admin/`, mounted only in debug) or by
`seed_demo`.

- **`POST /auth/register`** — body `{email, password, name}`. Email is
  normalised and must be unique (case-insensitive); password must pass
  Django's validators (≥8 chars, not all-numeric, not common, not similar to
  email/name). `201` + user + cookies; `400` field errors.
- **`POST /auth/login`** — body `{email, password}`. `200` + user + cookies.
- **`POST /auth/logout`** — `204`.
- **`POST /auth/refresh`** — no body. `204` + new cookies; `401` if no/invalid
  refresh cookie or reuse detected.
- **`PATCH /profile`** — any of `name`, `email`, `phone`
  (`^\+?[0-9()\-.\s]{7,20}$`), `timezone` (valid IANA name),
  `sms_carrier` (one of `verizon, att, tmobile, sprint, uscellular, boost,
  cricket, metropcs, googlefi`, or `""`). Phone + carrier together opt the
  patient into SMS cancellation notices.
- **`POST /profile/password`** — `{current_password, new_password}`. `204`,
  fresh cookies for this session.
- **`POST /profile/delete-account`** — `{password}` (re-confirmation).
  ✎ `account:deletion_requested`, cancels every upcoming active booking
  (bypassing the 24 h rule), scrubs `name`/`phone`/`sms_carrier`/`email`, deactivates the
  account, stamps `deleted_at` — all in one transaction; then logs out.
  `200 {"cancelled_appointments_count": N}`. Details:
  [`backend/docs/retention-policy.md`](../backend/docs/retention-policy.md).

## Scheduling

`scheduling/views.py`, `scheduling/serializers.py`, `scheduling/schedule.py`,
`scheduling/slots.py`, `scheduling/collisions.py`. Prefix `/scheduling`.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /scheduling/providers` | any authenticated | List providers `[{id, name, timezone}]`. |
| `GET /scheduling/providers/<id>/appointment-types` | any authenticated | A provider's appointment types (`404` if not a provider). |
| `GET /scheduling/slots` | any authenticated | Open slots for a provider + appointment type + date range. |
| `GET /scheduling/schedule` | provider | Own weekly hours: `{current, pending}`. |
| `PUT /scheduling/schedule` | provider | Replace live hours or set a pending schedule. |
| `DELETE /scheduling/schedule/pending` | provider | Discard the pending schedule. |
| `GET /scheduling/availability` | own rows | Own **currently effective** hour blocks (flat list). |
| `GET` / `POST /scheduling/appointment-types` | own / provider | List / create appointment types. |
| `PATCH` / `DELETE /scheduling/appointment-types/<id>` | owner or admin | Rename / change duration / delete. |
| `GET` / `POST /scheduling/blocked-time` | own / provider | List / add blocked time. |
| `DELETE /scheduling/blocked-time/<id>` | owner or admin | Remove blocked time. |

### Slots — `GET /scheduling/slots`

Query: `provider_id`, `appointment_type_id`, `date_from`, `date_to` (all
required; `date_to ≥ date_from`; span **≤ 60 days** else `400`).

Response:

```json
{"provider_id": 3, "appointment_type_id": 7, "date_from": "2026-08-17", "date_to": "2026-08-23",
 "bookable": true, "reason": null,
 "slots": [{"start": "2026-08-17T13:00:00Z", "end": "2026-08-17T14:00:00Z"}, "…"]}
```

`bookable: false` with a `reason` when the provider has configured **no**
working hours at all (distinct from "hours but fully booked", which is
`bookable: true, slots: []`). Slots are computed fresh per request: for each
calendar day the governing hour generation is converted from the provider's
wall-clock to UTC (DST-safe), cut into `duration_minutes` pieces, minus
blocked time, minus the provider's active bookings, minus **the requesting
patient's own active bookings with any provider**, minus anything starting
in the past. `404` unknown provider/type.

### Weekly hours — `GET` / `PUT /scheduling/schedule`

Hours are **blocks**: `{day_of_week (0=Mon…6=Sun), start_time "HH:MM", end_time "HH:MM"}`
in the provider's timezone, several per day allowed. Rows are grouped into
*generations* by `effective_from`: `null` = the live schedule; a single
future date = the **pending** schedule that takes over on that date (chosen
at read time per calendar day — nothing promotes rows).

`GET` →

```json
{"timezone": "America/Chicago", "today": "2026-08-15",
 "current": {"effective_from": null, "windows": [{"id": 1, "day_of_week": 0, "start_time": "08:00", "end_time": "12:00"}, "…"]},
 "pending": {"effective_from": "2026-09-01", "windows": ["…"]}}
```

`pending` is `null` when there is none. Non-providers get `403`.

`PUT` body `{windows: [...], effective_from: null | "YYYY-MM-DD"}`:

1. Validation (`400 {"windows": {"<day>": ["…"]}}`): `end_time > start_time`,
   no overlapping blocks on a day, **≥ 1 hour gap** between blocks on the
   same day. `effective_from` must be `null` or after provider-local today.
2. Collision scan against active bookings up to **133 days** ahead: on a hit
   → `409 {"collisions": [{id, start_time, end_time, patient_name,
   appointment_type_name, status}], "earliest_safe_date": "YYYY-MM-DD" | null}`
   and **nothing is written**. `earliest_safe_date` is the first date a
   pending schedule could start without colliding.
3. Success `200` with the `GET` shape. `effective_from: null` replaces the
   live generation (leaving any pending one intact) ✎ `update:availability_schedule`;
   a date creates/replaces the pending one ✎ `schedule:availability_change`.

`DELETE /scheduling/schedule/pending` → `204` (`404` if none). No collision
check and no auto-cancel: bookings on/after the discarded date that no
longer fit the live hours are each ✎ `availability_change:booking_flagged_as_exception`.

### Appointment types

`{id, name, duration_minutes}`; `duration_minutes` ∈ **{30, 60}** (DB check
constraint), `name` unique per provider (`400` duplicate). Changing the
duration while future active bookings of that type exist → `409 {"detail", "collisions": [...]}`
(every future booking, no horizon cap); accepted change ✎ `update:appointment_type_duration`.
`DELETE` → `204`, no collision check.

### Blocked time

`{id, start, end, label?}` as UTC instants. `POST` with an optional
`resolution`:

| Request | No collision | Collision with active bookings |
|---|---|---|
| no `resolution` | `201`, created ✎ `create:blocked_time` | `409 {"collisions": [...]}`, nothing created |
| `resolution: "keep_new_hours"` | `201` | `201`, created, each booking ✎ `…booking_flagged_as_exception`, `collisions` echoed |
| `resolution: "cancel_change"` | `200 {"collisions": [], "resolution": "cancel_change"}` — nothing created | same |

`DELETE /scheduling/blocked-time/<id>` → `204` ✎ `delete:blocked_time`.

## Bookings

`bookings/views.py`, `bookings/services.py`, `bookings/transitions.py`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /bookings` | patient | Book a slot (auto-confirmed). |
| `GET /bookings` | provider (own) / admin | Calendar feed. |
| `GET /bookings/mine` | patient | Own appointments. |
| `PATCH /bookings/<id>/status` | booking's provider / admin | Complete, no-show, or cancel (with reason). |
| `PATCH /bookings/<id>/cancel` | booking's patient / admin | Patient self-cancel. |
| `PATCH /bookings/<id>/reschedule` | booking's patient / admin | Move to another slot. |

**Booking object**: `{id, provider_id, patient_id, appointment_type_id, start_time, end_time, status, cancellation_reason}`.
Statuses and legal moves (`bookings/transitions.py`):

```
requested → confirmed | cancelled
confirmed → completed | cancelled | no_show
completed, cancelled, no_show → (terminal)
```

Rules applied inside `transition()` for every caller: `no_show` only after
`start_time` has passed (`400`); **cancellation needs ≥ 24 h notice**
(`400`, "CancellationNoticeTooShort") whoever cancels — the only bypass is
account deletion. Every transition ✎ `status:<old>-><new>` in the same
transaction as the status write.

- **`POST /bookings`** — body `{provider_id, appointment_type_id, start_time}`;
  `end_time` is always derived server-side. Optional header
  **`Idempotency-Key`** (≤255 chars): a replay with the same key by the same
  patient returns the original booking; the same key from another patient →
  `409`. Created as `requested` and moved to `confirmed` in the same
  transaction (✎ `create:booking` + `status:requested->confirmed`). `201`.
  `400` unknown provider/type or slot not open (outside hours / blocked /
  past); `409 "This slot is no longer available."` (lost race — row lock,
  unique index or exclusion constraint), `409 "You already have an appointment
  that overlaps this time."`, `403` non-patient. Guard details:
  [`architecture.md` §3](../architecture.md#3-double-booking-guard-combine-medplums-and-calcoms-mechanisms).
- **`GET /bookings`** — query `provider_id?` (admin only; a provider is
  always scoped to self), `date_from` + `date_to` (together, calendar-day
  bounds in the calendar owner's timezone). Items
  `{id, patient_id, patient_name, appointment_type_name, start_time, end_time, status, cancellation_reason}`.
  ✎ `read:booking_list` (provider) or `admin_bypass:list_provider:booking` /
  `admin_bypass:list_all:booking`. `403` for patients.
- **`GET /bookings/mine`** — no params; items
  `{id, provider_id, provider_name, provider_timezone, appointment_type_id, appointment_type_name, start_time, end_time, status, reminder_sent, cancellation_reason}`.
  Not audited (self-read).
- **`PATCH /bookings/<id>/status`** — body `{status: "completed"|"cancelled"|"no_show", cancellation_reason?}`.
  `cancellation_reason` is **required, non-blank, ≤500 chars** when
  cancelling and rejected otherwise. Cancelling is throttled 10/min per
  account. `200` booking; when cancelled the body also carries
  `notification: {email_sent, email_failed, sms_attempted, sms_sent, sms_skipped_reason, rate_limited}`
  from the patient-notification step, which runs after the cancel has
  committed and never fails the request (`bookings/notifications.py`).
  `400` illegal transition / no-show too early / <24 h; `403` not this
  booking's provider (admin bypass audited); `404`.
- **`PATCH /bookings/<id>/cancel`** — no body. `200`. Same 24 h rule. No
  notification is sent for a patient's own cancellation.
- **`PATCH /bookings/<id>/reschedule`** — body `{start_time}` (provider and
  type cannot change). Atomically: lock, check 24 h notice against the
  *original* start, cancel the old booking, book the new slot through the
  same guard as `POST /bookings`. `200` new booking + `previous_booking_id`
  ✎ `reschedule:booking`. `400` / `409` as for create.

## Audit log

`audit/views.py`, `audit/pagination.py`. **Admin only** (`403` otherwise).

`GET /audit-log?actor=<user id>&action=<substring>&target_type=<exact>&date_from=…&date_to=…&page=1&page_size=25`

- `date_from`/`date_to`: ISO 8601 datetime or bare date (a bare date expands
  to that whole UTC day). `page_size` max 100.
- Response `{"results": [{id, actor, action, target_type, target_id, timestamp, metadata}], "count", "page", "page_size"}`.
- Every successful read is itself ✎ `read:audit_log` (written *after* the
  page is built, so a response never contains the row recording itself).
- There is no write endpoint. Rows can never be updated or deleted: the ORM
  raises `AuditLogIsAppendOnly` and a Postgres trigger rejects raw SQL
  (`audit/models.py`, `audit/migrations/0002_append_only_trigger.py`).

Action strings you will see: `create:booking`, `status:<a>-><b>`,
`reschedule:booking`, `read:booking_list`, `read:audit_log`,
`create:blocked_time`, `delete:blocked_time`, `update:availability_schedule`,
`schedule:availability_change`, `availability_change:booking_flagged_as_exception`,
`update:appointment_type_duration`, `account:deletion_requested`,
`admin_bypass:<action>:<target_type>`.

## Health

`GET /health` (public, `core/views.py`) — runs `SELECT 1`.
`200 {"status": "ok", "database": "reachable"}` or
`503 {"status": "degraded", "database": "unreachable"}`.

## Management commands

| Command | What it does |
|---|---|
| `python manage.py seed_demo` | Idempotent demo dataset: 1 admin, 25 patients, 15 providers with hours/appointment types, ~305 bookings over 133 days + a 100-booking weekly cohort. Password `demo-password-not-for-prod`. See [`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md). |
| `python manage.py dispatch_reminders` | Sends the 24 h reminder email for confirmed bookings starting 23–25 h from now, deduplicated by `ReminderLog(booking, interval)`; the Railway cron entry point. See [`backend/reminders/README.md`](../backend/reminders/README.md). |
| `python manage.py createcachetable` | Creates the `django_cache` table the throttle/lockout counters use outside debug (run by the Railway start command). |

Standard Django commands (`migrate`, `test`, `createsuperuser`, …) apply as
usual.
