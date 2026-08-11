# k6 load tests (TICKET-13)

Two scripts, one per benchmark in `project.md`'s Performance Benchmarks table:

| Script | Endpoint | Target |
|---|---|---|
| `slot-availability.js` | `GET /scheduling/slots` | p95 < 1.0s |
| `booking-action.js` | `POST /bookings` | p95 < 1.0s |

Both run at the brief's stated load -- **20-50 concurrent virtual users for
60s** -- against the dataset `core/management/commands/seed_demo.py` seeds
(~10 providers, ~16,000 computed slots; see that file's docstring for the
exact arithmetic). Each declares an explicit k6 `thresholds` entry
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

Both scripts log in **once**, in k6's `setup()` (which runs before any VU
starts), and pass the resulting session cookie to every VU via `setup()`'s
returned `data`. This was a deliberate fix, not the initial design: logging
in once *per VU* is the more obviously "realistic" choice and is what this
script started with, but `POST /auth/login` is throttled to 5/min per
source IP (`accounts/views.py`'s `LoginRateThrottle`), and every VU in a k6
run shares one source IP. Confirmed empirically while building this script
-- at `VUS=30` with a once-per-VU login, ~25 of the 30 VUs got a `429` at
test start and never reached the endpoint under test at all. A shared
15-minute access token comfortably outlives a 60s run, so one login has no
accuracy cost.

## Results from a local run (informational, not the deployed benchmark)

Run 2026-08-11 against a local Postgres 16 instance and Django's
**development** server (`manage.py runserver`, not a production WSGI
server) on this machine, `VUS=30`, `DURATION=60s`, immediately after
`python manage.py seed_demo`:

| Script | p95 | Threshold | Result |
|---|---|---|---|
| `slot-availability.js` | **257ms** | < 1000ms | PASS |
| `booking-action.js` | **542ms** | < 1000ms | PASS |

Both runs' `checks` rate was >99%. A small fraction of requests (<1%,
both runs) failed at the connection level rather than returning an
unexpected HTTP status -- consistent with `manage.py runserver`'s known
limits under concurrent load on Windows, not the endpoint logic (every
logged HTTP response for `/scheduling/slots` and `/bookings` during both
runs was 200/201/409/400, all expected outcomes; a real deployment sits
behind a production WSGI server, per architecture.md's Railway hosting
choice). `booking-action.js` also logged one `400` (`SlotNotOpen`) among
~1,735 bookings -- two iterations picked different appointment types for
the same provider whose slots happened to overlap, and the second lost that
overlap to the first between its own `GET` and `POST` calls; a real, if
rare, guard path (architecture.md §3), not a script bug.

**This machine is not the deployed environment** -- these numbers are an
end-to-end proof the harness works and produces a real data point, not the
project's actual benchmark result.
