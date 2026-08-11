# TICKET-07 — Booking Creation + No-Double-Booking Guard + Auto-Accept (critical ticket)

**Blockers:** TICKET-06, TICKET-03
**Scope:** Both
**Size:** Right-sized — kept deliberately pure. Status lifecycle beyond initial confirm, reschedule, and cancel are excluded and live in later tickets.

This is the brief's 20-point pass/fail gate. See `architecture.md` §3 for the full concurrency-guard design and §4 for the auto-accept business rule — both are load-bearing for this ticket's acceptance criteria.

## Build
- `POST /bookings` wrapped in `transaction.atomic()` + `select_for_update()` re-check inside the transaction (Layer 1 guard).
- Unconditional `UniqueConstraint` on `(provider_id, start_time)` scoped to active statuses (Layer 2 guard, migration).
- **Auto-confirm**: on successful insert, the booking is created as `REQUESTED` and immediately transitioned to `CONFIRMED` in the same request/transaction (via TICKET-08's `transition()` function once that lands — sequence the integration accordingly). There is **no pending/awaiting-approval state** exposed to the patient.
- Server-side dedup of double-submitted/retried requests (idempotency key or equivalent — not client-side button-disable alone).
- "Book" / "Confirm booking" button wired end-to-end (see `wireframes.html` Screen 2 confirm panel), disabling immediately on click, with clear conflict messaging on failure.
- Automated concurrent test against real Postgres (N simultaneous requests on the last open slot, assert exactly 1 success), committed to the repo.

## Accept
- Booking a displayed slot creates a persisted, **already-confirmed** appointment, returns a confirmation, and immediately removes that slot from the open list.
- Two simultaneous requests on the last open slot → exactly one succeeds and lands as `CONFIRMED`; the other gets a clear "slot no longer available" error (see Screen 2's race-lost state) — never two confirmed bookings for one slot.
- Concurrency test explicitly runs against real Postgres (not SQLite — `select_for_update` is a silent no-op there).
- Double-click/retry on "book" produces at most one appointment.
- ≥80% coverage on the booking engine + concurrency guard.
