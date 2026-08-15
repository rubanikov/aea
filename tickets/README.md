# Ticket Slate — Patient Appointment & Scheduling Portal

Published 2026-08-11. 14 vertical tickets, each a DB→backend→frontend slice. Sourced from `project.md` (spec) + `architecture.md` (technical decisions) + `wireframes.html` (UI, published as a Claude artifact). Full sourcing and rationale for every technical/UI choice lives in those three documents — this index is the build-tracking layer on top.

Cross-cutting acceptance criteria on every ticket unless noted backend-only: server-side input validation with clear non-500 errors; structured error logging with no PHI (IDs/references only); accessible UI (keyboard nav, labeled controls, status conveyed by more than color); empty/first-run states render cleanly; new secrets added to `.env.example`.

## Build waves

| Wave | Tickets | Notes |
|---|---|---|
| 0 | 01 | zero blockers — everything else waits on this |
| 1 | 02 | needs 01 |
| 2 | 03 ∥ 04 | disjoint schemas, build in parallel |
| 3 | 05 (+ 14 anytime after 02+03) | needs 04 |
| 4 | 06 | needs 05 |
| 5 | **07** | needs 06 + 03 — the critical-path bottleneck |
| 6 | 08 ∥ 11 ∥ 13 | all independent of each other once 07 lands |
| 7 | 09 ∥ 12 | 09 needs 08; 12 needs 07+08 |
| 8 | 10 | needs 09 |

Every ticket is Both-scope (backend+frontend build in parallel within it) except TICKET-13 (backend-only).

## Scope adjustments folded in after the wireframe + duration/auto-accept review (before Wave 0 started)

1. **TICKET-01** — explicitly includes the role-gated nav shell (patient/provider/admin) and route guarding, not just repo/CI/deploy scaffolding.
2. **TICKET-02** — widened to "auth & profile": includes the account-settings UI (profile view/edit, password update), not just register/login.
3. **TICKET-03** — explicitly includes the audit-log *viewer* screen (filters, pagination, table), not only the backend write path.
4. **TICKET-04** — widened to include an `AppointmentType` model (name + duration) and its CRUD UI. Duration is per-appointment-type (10–60 min range, provider-configured), not a single global slot length — grounded in real scheduling norms, not just precedent (see `wireframes.html` footer for sources).
5. **TICKET-07** — acceptance criteria updated: booking creation auto-confirms synchronously (`REQUESTED→CONFIRMED` in the same request, architecture.md §4) — no pending/awaiting-approval state to build. Explicitly includes the race-error UI and double-submit-safe button.
6. **TICKET-08** — drops the Confirm/Decline UI entirely (bookings arrive pre-confirmed); provider calendar view is a week-strip + agenda list, not a FullCalendar-style grid.
7. **TICKET-09/12** — the "reminder sent" indicator badge on the appointment list is owned by TICKET-12 (it owns the underlying `ReminderLog` data), added to TICKET-09's UI as a small addendum.
8. **TICKET-11** — widened to explicitly include the collision-warning modal UI (radio-button resolution choice, affected-appointments list), not just a backend 409 response.
9. **TICKET-14** — explicitly includes the deletion-request UI (danger-zone card, typed-confirmation modal, pending-deletion banner).

## Built after the slate (not covered by TICKET-01…14)

All 14 tickets shipped. The following landed afterwards as follow-up features
and hardening passes; their planning artifacts live under `.scratch/<feature>/`
rather than here, and their as-built behaviour is documented in
`architecture.md` §10 and [`docs/features.md`](../docs/features.md).

| Feature / pass | What it added | Where |
|---|---|---|
| Doctor cancellation reason + patient notification | Provider cancel requires a written reason (≤500 chars); patient gets an email and, if they've saved a phone + carrier, an SMS via the carrier's email-to-SMS gateway. Per-recipient hourly budget + endpoint throttle. | `bookings/notifications.py`, `Booking.cancellation_reason`, `CancellationNotificationLog`, `User.sms_carrier` |
| Theme toggle + UI redesign | Light/dark theme (persisted in `localStorage`, contrast-tested), shadcn-style primitives, week-grid provider and patient calendars, four-step booking wizard, error boundaries. | `frontend/components/theme`, `components/calendar`, `components/booking`, `app/error.tsx` |
| Settings nav + multi-block hours | Portal nav stays visible on `/settings`; working hours are multiple blocks per weekday (≥1 h gap between blocks) with an optional future `effective_from` — a *pending* schedule that applies from that date; discard endpoint; pending banner. | `scheduling/schedule.py`, `GET/PUT /scheduling/schedule`, `DELETE /scheduling/schedule/pending`, `components/availability/WorkingHoursSection.tsx` |
| Overlap exclusion constraints + one-per-hour rule | Postgres GiST exclusion constraints on active bookings (per provider and per patient) so mixed 30/60-min bookings can't overlap; deadlock-abort mapped to 409. | `bookings/migrations/0005_no_overlapping_active_bookings.py`, `bookings/services.py` |
| 133-day seed horizon | `seed_demo` and the collision scan cover 133 days (~16,150 slots) to match the k6 benchmark. | `core/management/commands/seed_demo.py`, `scheduling/collisions.py` |
| Hardening pass | Login lockout (10 failures / 15 min), refresh-token rotation with reuse detection, JSON-only error handler (never an HTML 500), 64 KB request-body cap (413), `Cache-Control: no-store` on every response, JSON logging outside debug, audit append-only DB trigger, `Idempotency-Key` on `POST /bookings`, transactional account deletion, `requirements.lock`, Railway cron config-as-code. | `accounts/lockout.py`, `accounts/tokens.py`, `core/exceptions.py`, `core/middleware.py`, `core/logging.py`, `audit/migrations/0002_*` |

## Stretch — not sliced in this slate

Waitlist + auto-fill (#8), telehealth video link (#9), recurring appointments (#10), insurance/intake PHI capture (#11), natural-language booking (#12) are explicitly out of scope. Waitlist in particular needs its own concurrency design if pulled in later — nothing in TICKET-07's guard covers "who gets the slot when it frees."

README, `AI_USAGE.md`, the written retention/deletion policy doc, BAA vendor-disclosure writeup, and the video demo are Submission Requirements, not vertical tickets — final packaging checklist against the finished tickets, not their own build step.
