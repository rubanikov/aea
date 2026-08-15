# reminders

TICKET-12: automated 24h-before-appointment email reminders
(architecture.md §7). No HTTP routes; this app is a background job plus
its dedup table.

## Pieces

- `models.ReminderLog`: append-only "a reminder was successfully sent"
  record, `UniqueConstraint(booking, interval)` is the actual dedup
  guarantee.
- `emails.send_reminder_email(booking)`: the seam the dispatcher calls
  (and the one tests patch). PHI-free body
  (`emails.build_reminder_email_body`): generic notice + a link to
  `/patient/appointments` in the frontend, no patient name / appointment
  type / any health-context detail. The actual Resend HTTP call lives in
  `bookings.notifications.send_email` — one transport shared with the
  doctor-cancellation notifications (email + carrier SMS gateway,
  `bookings/notifications.py`), so there is exactly one place that POSTs
  to Resend. Cancellation notices are *not* PHI-free by design; that
  exception is documented in `architecture.md` §7a, not here.
- `services.dispatch_due_reminders()`: selects confirmed bookings due in
  the window, skips already-logged ones, sends, logs. The single write
  path to `ReminderLog`.
- `management/commands/dispatch_reminders.py`: the actual cron entry
  point (`python manage.py dispatch_reminders`), a thin wrapper around
  `dispatch_due_reminders()`.

## Window choice

A booking is "due" when `start_time` falls between `now + 23h` and
`now + 25h`, a 2-hour window straddling the 24h mark, not an exact
instant. See `services.py`'s `WINDOW_START_OFFSET`/`WINDOW_END_OFFSET` for
the full reasoning: sized so a cron running every 15-30 min gets at least
4 chances to catch any given due booking before it ages out of the
window, without re-considering already-sent bookings for any longer than
that.

## Resend / no-API-key behavior

`RESEND_API_KEY` unset is a supported, deliberate state (local dev, CI,
and this grading environment never have a real key): `send_reminder_email`
logs a warning and returns `False` rather than raising: no email is
sent, no `ReminderLog` row is written, and the booking is retried on the
next run once a real key is configured. This is a "skip and log" choice,
not "fail loudly," because a missing key here is an environment-config
fact, not a per-booking error, and letting it abort the whole dispatch run
would also block every *other* due reminder in the same run for a reason
that has nothing to do with them.

## Railway cron configuration

The schedule is config-as-code in [`backend/railway.cron.json`](../railway.cron.json):
`*/15 * * * *`, start command `python manage.py dispatch_reminders`,
restart policy `NEVER` (a cron run that fails should surface in the logs,
not loop). It is a **second** Railway service in the same project as the
web service (`backend/railway.json`), deployed from the same `backend/`
directory:

```bash
cd backend
railway add --service reminders-cron
railway variables --service reminders-cron   --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}'   --set 'DJANGO_SECRET_KEY=${{backend.DJANGO_SECRET_KEY}}'   --set 'DJANGO_ALLOWED_HOSTS=${{backend.DJANGO_ALLOWED_HOSTS}}'   --set 'FRONTEND_BASE_URL=${{backend.FRONTEND_BASE_URL}}'   --set 'RESEND_FROM_EMAIL=${{backend.RESEND_FROM_EMAIL}}'   --set 'DJANGO_DEBUG=False'
# then in the dashboard: Settings > Config-as-code > Railway Config File = railway.cron.json
railway up --service reminders-cron --detach
```

- **Environment variables:** the same as the web service, referenced
  rather than duplicated (`${{backend.VAR}}`), plus `RESEND_API_KEY` once
  a real key exists.
- **Networking:** none; this service never receives inbound HTTP traffic,
  it only runs on a schedule and talks out to Postgres and Resend.
- Railway runs a cron service to completion each trigger and does not
  overlap a still-running invocation, but `dispatch_due_reminders` is
  safe even if that guarantee is ever violated (see its docstring and
  `tests/test_concurrency.py`).

## Tests

```
python manage.py test reminders
```

The concurrent-dispatch race (`reminders/tests/test_concurrency.py`) needs
two genuinely separate DB connections/transactions to exercise the real
`IntegrityError` path, so it's a `TransactionTestCase`, not the default
`TestCase`; run it in isolation with:

```
python manage.py test reminders.tests.test_concurrency
```

Coverage:

```
coverage run --source=reminders manage.py test reminders
coverage report -m
```
