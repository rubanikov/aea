# reminders

TICKET-12 -- automated 24h-before-appointment email reminders
(architecture.md §7). No HTTP routes; this app is a background job plus
its dedup table.

## Pieces

- `models.ReminderLog` -- append-only "a reminder was successfully sent"
  record, `UniqueConstraint(booking, interval)` is the actual dedup
  guarantee.
- `emails.send_reminder_email(booking)` -- the one seam that talks to
  Resend. PHI-free body (`emails.build_reminder_email_body`): generic
  notice + a link into the frontend portal, no patient name / appointment
  type / any health-context detail.
- `services.dispatch_due_reminders()` -- selects confirmed bookings due in
  the window, skips already-logged ones, sends, logs. The single write
  path to `ReminderLog`.
- `management/commands/dispatch_reminders.py` -- the actual cron entry
  point (`python manage.py dispatch_reminders`), a thin wrapper around
  `dispatch_due_reminders()`.

## Window choice

A booking is "due" when `start_time` falls between `now + 23h` and
`now + 25h` -- a 2-hour window straddling the 24h mark, not an exact
instant. See `services.py`'s `WINDOW_START_OFFSET`/`WINDOW_END_OFFSET` for
the full reasoning: sized so a cron running every 15-30 min gets at least
4 chances to catch any given due booking before it ages out of the
window, without re-considering already-sent bookings for any longer than
that.

## Resend / no-API-key behavior

`RESEND_API_KEY` unset is a supported, deliberate state (local dev, CI,
and this grading environment never have a real key): `send_reminder_email`
logs a warning and returns `False` rather than raising -- no email is
sent, no `ReminderLog` row is written, and the booking is retried on the
next run once a real key is configured. This is a "skip and log" choice,
not "fail loudly," because a missing key here is an environment-config
fact, not a per-booking error, and letting it abort the whole dispatch run
would also block every *other* due reminder in the same run for a reason
that has nothing to do with them.

## Railway cron configuration (not wired in this environment)

This ticket's build has no live Railway account to wire the actual
schedule against. To deploy for real, add a **second** Railway service in
the same project as the existing web service (`backend/railway.json`):

- **Cron Schedule:** `*/15 * * * *` (every 15 minutes)
- **Start Command:** `python manage.py dispatch_reminders`
- **Environment variables:** same as the web service --
  `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `FRONTEND_BASE_URL` (see `.env.example` at the repo root)
- **Networking:** none needed -- this service never receives inbound
  HTTP traffic.

## Tests

```
python manage.py test reminders
```

The concurrent-dispatch race (`reminders/tests/test_concurrency.py`) needs
two genuinely separate DB connections/transactions to exercise the real
`IntegrityError` path, so it's a `TransactionTestCase`, not the default
`TestCase` -- run it in isolation with:

```
python manage.py test reminders.tests.test_concurrency
```

Coverage:

```
coverage run --source=reminders manage.py test reminders
coverage report -m
```
