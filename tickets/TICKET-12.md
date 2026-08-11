# TICKET-12 — Automated Email Reminders (Resend + Idempotent Dispatch)

**Blockers:** TICKET-07, TICKET-08
**Scope:** Both (mostly backend; small "reminder sent" indicator on the appointment views from TICKET-08/09)
**Size:** Right-sized

## Build
- `ReminderLog` model with `UniqueConstraint(booking, interval)` — see `architecture.md` §7.
- Railway cron (every 15–30 min) selecting confirmed bookings due for reminder, left-joined against `ReminderLog` to skip already-sent, dispatching via Resend, catching unique-violation on concurrent/retried runs.
- PHI-free email body (generic reminder + secure link, no PHI in third-party email content).
- **"Reminder sent" indicator**: fills in the placeholder left in TICKET-09's appointment card (e.g. "✉ Reminder sent 24h before, Aug 17 10:00am") and TICKET-08's provider calendar rows.

## Accept
- Reminder sent once per appointment/interval even under retry/crash-restart/overlapping cron runs (enforced by the DB constraint, not timing).
- Each attempt logged.
- ≥99% of due reminders sent with 0 duplicates, measurable from job logs.
- ≥80% coverage on reminder scheduling logic.
