"""architecture.md §7's "safe under overlapping/retried cron runs"
guarantee, exercised for real -- two genuinely concurrent
`dispatch_due_reminders()` calls, each on its own thread/DB connection,
racing to send the *same* booking's 24h reminder.

Why `TransactionTestCase`, not `TestCase`
------------------------------------------
Same reasoning as `bookings/tests/test_concurrency.py`: Django's default
`TestCase` wraps a whole test method in one outer, uncommitted transaction
on the main thread's connection. A second thread's connection would never
see the fixture `Booking` row `setUp` created (never committed anywhere),
and Postgres's constraint-violation-at-statement-time behavior this test
depends on needs two real, separate, committed-data connections.
`TransactionTestCase` flushes tables after each test instead, so both
threads see real committed data and race for real.

How the race is forced
-----------------------
`send_reminder_email` is patched (once, from the main thread, wrapping
both threads' entire run -- patching from *inside* each thread would race
the patch/unpatch machinery itself against the other thread, which is a
bug in the test, not in the code under test) to block on a two-party
`threading.Barrier` before returning `True`. Since
`dispatch_due_reminders`'s "is this booking already logged" query runs
*before* it calls `send_reminder_email` (the query backing the `for
booking in due_bookings:` loop), pausing inside the mocked send
guarantees both threads have already independently queried and found the
booking "due" (neither has written `ReminderLog` yet) before either one
reaches the `ReminderLog.objects.create(...)` write -- the exact
check-then-write race window the unique constraint exists to close. Both
threads are released from the barrier together, both attempt the insert,
and only one can win.
"""

import threading
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase

from bookings.models import Booking
from reminders.models import ReminderLog
from reminders.services import dispatch_due_reminders
from scheduling.models import AppointmentType, Availability

from .helpers import utc

User = get_user_model()

NOW = utc(2026, 8, 17, 9, 0)
CONCURRENT_RUNS = 2


class ConcurrentDispatchTests(TransactionTestCase):
    def setUp(self):
        self.provider = User.objects.create_user(
            email="reminder-provider@example.com",
            password="a-strong-unique-passphrase-42",
            role=User.Role.PROVIDER,
            timezone="UTC",
        )
        self.patient = User.objects.create_user(
            email="reminder-patient@example.com",
            password="a-strong-unique-passphrase-42",
            role=User.Role.PATIENT,
        )
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="00:00", end_time="23:59"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=30
        )
        self.booking = Booking.objects.create(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=NOW + timedelta(hours=24),
            end_time=NOW + timedelta(hours=24, minutes=30),
            status=Booking.Status.CONFIRMED,
        )

    def _run_dispatch(self, results, index):
        try:
            results[index] = dispatch_due_reminders(now=NOW)
        except Exception as exc:  # surfaced to the main thread's assertions, not swallowed
            results[index] = exc
        finally:
            connection.close()

    def test_two_concurrent_dispatch_runs_write_exactly_one_reminder_log_row(self):
        send_barrier = threading.Barrier(CONCURRENT_RUNS)

        def _blocking_send(booking):
            send_barrier.wait(timeout=30)
            return True

        results = [None] * CONCURRENT_RUNS
        threads = [
            threading.Thread(target=self._run_dispatch, args=(results, i))
            for i in range(CONCURRENT_RUNS)
        ]

        # Patched once, from the main thread, before either thread starts
        # -- both threads share this one mock for the whole race; see the
        # module docstring for why patching from inside each thread would
        # be a race in the test itself.
        with patch("reminders.services.send_reminder_email", side_effect=_blocking_send):
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)

        for thread in threads:
            self.assertFalse(thread.is_alive(), "a concurrent dispatch run hung")
        for index, result in enumerate(results):
            self.assertNotIsInstance(result, Exception, f"thread {index} raised: {result!r}")

        # Both runs considered the booking "due" (that's the race), but
        # the DB constraint -- not timing -- ensures only one of them
        # actually recorded the send.
        self.assertEqual([r.considered for r in results], [1, 1])
        sent_counts = sorted(r.sent for r in results)
        already_logged_counts = sorted(r.already_logged for r in results)
        self.assertEqual(sent_counts, [0, 1], results)
        self.assertEqual(already_logged_counts, [0, 1], results)

        logs = ReminderLog.objects.filter(booking=self.booking, interval=ReminderLog.INTERVAL_24H)
        self.assertEqual(logs.count(), 1)
