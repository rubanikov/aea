# k6 load tests (TICKET-13)

Two scripts, one per benchmark in `project.md`'s Performance Benchmarks table:

| Script | Endpoint | Target |
|---|---|---|
| `slot-availability.js` | `GET /scheduling/slots` | p95 < 1.0s |
| `booking-action.js` | `POST /bookings` | p95 < 1.0s |

Both run at the brief's stated load -- **20-50 concurrent virtual users for
60s** -- against the dataset `core/management/commands/seed_demo.py` seeds
(10 k6 providers, **16,150** gross computed slots over a **133-day** horizon;
see that file's docstring for the exact arithmetic). Each declares an explicit
k6 `thresholds` entry
(`p(95)<1000` on the tagged request), so a run visibly passes or fails --
you don't have to eyeball a number.

## Prerequisites

- k6 installed (https://k6.io/docs/get-started/installation/) -- not a repo
  dependency, a separate tool you run against the running backend.
- Postgres running and reachable at `DATABASE_URL` (see `backend/.env.example`
  / the repo root `.env.example`). `select_for_update` -- the double-booking
  guard both scripts exercise via `booking-action.js` -- is a documented
  silent no-op on SQLite (architecture.md §3), so this must be real Postgres.
- The Django backend migrated, seeded, and running.

## Reproducing from a clean checkout

```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate  # or .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000
```

In a second terminal, from the repo root:

```bash
k6 run k6/slot-availability.js
k6 run k6/booking-action.js
```

Both default to `BASE_URL=http://localhost:8000`, `VUS=30`, `DURATION=60s`.
Override any of them with `-e`, e.g. to run at the top of the brief's stated
range:

```bash
k6 run -e BASE_URL=http://localhost:8000 -e VUS=50 -e DURATION=60s k6/slot-availability.js
```

`k6/helpers.js` is a small shared module (login, provider/appointment-type
discovery, date-window randomization) both scripts import -- not a separate
thing you need to run.

## What each script does

**`slot-availability.js`** -- each iteration queries a random `(provider,
appointment type, 14-day window)` combination discovered from whatever
`seed_demo` actually seeded (via `GET /scheduling/providers` and
`GET /scheduling/providers/<id>/appointment-types` in `setup()`, not
hardcoded IDs). 10 providers x 2-4 appointment types x many possible date
windows gives real query variety -- this deliberately isn't the same URL
hit in a tight loop, which wouldn't exercise the DB the way real patient
browsing does.

**`booking-action.js`** -- the trickier one: 20-50 VUs can't all try to book
the *same* slot repeatedly (that mostly measures the conflict-rejection
path, not real write latency, and exhausts the seeded slot pool almost
immediately). Each iteration instead:

1. Picks a random `(provider, appointment type, 14-day window)`, same as
   `slot-availability.js`.
2. Calls `GET /scheduling/slots` for that combination (tagged
   `slot_lookup` -- *not* counted toward the `booking_action` p95, since
   it's a lookup, not the action being measured).
3. Books a **randomly chosen** slot from that response (not always the
   first), which is what actually keeps concurrent VUs from converging on
   the same slot just because they queried the same provider/type/window
   in the same second.

A genuine double-booking race (two VUs draw the same slot) is still
possible and is treated as a correct, expected outcome -- the script's
`check` accepts `201` (booked) or `409` (lost a real race, architecture.md
§3's guard working as designed), and only anything else counts as a
failure. `booking_succeeded_rate` and `booking_no_open_slot_found` (a
`Counter`, for a query window that happened to return zero slots) are
exported as extra custom metrics for visibility into how often either
happens.

The alternative the ticket also allows -- pre-computing disjoint
provider+time slices per VU so no two VUs can ever contend for the same
slot -- would remove that residual race entirely, but it would also stop
measuring what the guard costs under real concurrent traffic, which is
part of what "genuine booking-action latency" should include here.

## Login: once per run, not once per VU

Both scripts log in once in k6's `setup()` and pass the session cookie to every
VU via `setup()`'s returned `data`. Per-VU login hits the 5/min IP throttle on
`POST /auth/login` (at `VUS=30`, most VUs got `429` before reaching the endpoint
under test). A 15-minute access token outlives a 60s run.

`k6/helpers.js` randomizes 14-day query windows (`QUERY_WINDOW_DAYS=13`) across
the seeded **133-day** horizon (`HORIZON_START_OFFSET_DAYS=1`,
`HORIZON_END_OFFSET_DAYS=131`), staying under `GET /scheduling/slots`'s
60-day range cap.

## Results from a local run (informational, not the deployed benchmark)

Run **2026-08-13** against a local Postgres 16 instance and a **Waitress**
WSGI server (16 threads) on this machine, `VUS=30`, `DURATION=60s`,
immediately after `python manage.py seed_demo` on the **133-day seed**
(16,150 gross computed slots). Django's `manage.py runserver` dropped
connections under this load on Windows (same class of failure as the
2026-08-11 note below), so the re-run used Waitress rather than the
dev server. Thresholds remain `p(95)<1000` and were not weakened.

One deliberate deviation from production settings, stated so the numbers
can be read correctly: DRF's per-account throttle (`user: 300/min`,
`backend/config/settings.py`) was lifted for the local server process the
run targeted. Both scripts share **one** login across all VUs (see "Login:
once per run" above), so at 30 VUs the ~2,800 requests/min this run
generated would otherwise have been 429'd after the first 300 -- the
throttle would have measured itself, not the slot query. Nothing about the
endpoint, the query, or the data was changed. The throttle is a per-user
abuse control, not a capacity limit; a real clinic's 30 concurrent
patients are 30 accounts, each far below 300/min.

| Script | p95 | Threshold | Result |
|---|---|---|---|
| `slot-availability.js` | **252ms** | < 1000ms | PASS |
| `booking-action.js` | **652ms** | < 1000ms | PASS |

Both runs' `checks` rate was 100%. `booking-action.js` accepted 201 or 409
as success; `booking_succeeded_rate` was 93% (665/714 bookings that found
an open slot). A production deployment sits behind gunicorn on Railway,
per architecture.md.

**This machine is not the deployed environment** -- these numbers prove
the harness still passes under the expanded seed, not the project's
Railway benchmark.

Earlier run **2026-08-11** (56-day seed, 6,800 slots, `manage.py runserver`):
slot-availability **257ms**, booking-action **542ms**, both PASS, checks
>99%, with a small fraction of connection-level failures on the Windows
dev server.
