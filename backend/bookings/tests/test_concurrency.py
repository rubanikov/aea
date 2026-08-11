"""architecture.md §3's pass/fail concurrency gate, exercised for real: N
genuinely concurrent threads, each with its own DB connection and its own
logged-in `Client`, all firing `POST /bookings` at the exact same last-open
slot at (as close as a `threading.Barrier` can get) the same instant.

Why `TransactionTestCase`, not `TestCase`
------------------------------------------
Django's default `TestCase` wraps the *entire* test method in one outer,
uncommitted transaction (using savepoints for anything nested inside it) on
the main thread's DB connection. A second thread gets its own, separate
connection -- and on that connection, the fixture rows `setUp` created
(provider, availability, appointment type) would never even be visible,
because they were never committed anywhere; they only exist inside the main
thread's still-open transaction. Worse, Postgres's `select_for_update()`
row lock -- half of this ticket's guard -- only does anything meaningful
across genuinely separate, committed transactions; a single wrapping
transaction defeats the entire premise of the test. `TransactionTestCase`
flushes tables after each test instead of wrapping in a transaction, so
every thread's connection sees real, committed data and takes/waits on
real Postgres row locks and real unique-index conflicts -- this is also
exactly why `select_for_update()` is a silent no-op on SQLite (no such
thing as a real cross-connection lock there) and why this test would
falsely pass against it; the project's DB is Postgres end to end (see
`config/settings.py`'s `DATABASE_URL` default and `.github/workflows/ci.yml`'s
Postgres service), so that failure mode never applies here, but it's the
reason this specific `TestCase` subclass is non-negotiable.

Each Python thread lazily gets its own DB connection the first time it
touches the database (Django's `connections` registry is thread-local) --
no manual connection wiring is needed beyond closing each thread's
connection when it's done (`connection.close()` in `_book`'s `finally`),
so nothing lingers past the test.
"""

import threading
from datetime import datetime
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client, TransactionTestCase

from accounts.tests.helpers import TEST_PASSWORD
from audit.tests.helpers import login_as
from bookings.models import Booking
from scheduling.models import AppointmentType, Availability

User = get_user_model()

CONCURRENT_REQUESTS = 10

AJAX_HEADERS = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class ConcurrentBookingTests(TransactionTestCase):
    def setUp(self):
        self.provider = User.objects.create_user(
            email="provider@example.com",
            password=TEST_PASSWORD,
            role=User.Role.PROVIDER,
            timezone="UTC",
        )
        # A single one-hour working-hours window sized to exactly one
        # appointment -- there is only ever one bookable slot in this whole
        # fixture, i.e. "the last open slot" the brief's scenario is about.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="10:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        # 2026-08-17 is a Monday, matching day_of_week=0 above.
        self.start_time = datetime(2026, 8, 17, 9, 0, tzinfo=dt_timezone.utc)
        self.start_time_iso = "2026-08-17T09:00:00Z"

        # Logins happen up front, sequentially, on the main thread -- not
        # inside the timed race below. This keeps the race itself isolated
        # to exactly the thing under test (`POST /bookings`), and sidesteps
        # `LoginRateThrottle` (5/min, IP-scoped) entirely rather than
        # working around it, the same "skip the throttled endpoint, set the
        # auth cookie directly" technique `audit/tests/helpers.py`'s
        # `login_as` already exists for.
        self.clients = []
        for i in range(CONCURRENT_REQUESTS):
            patient = User.objects.create_user(
                email=f"patient{i}@example.com", password=TEST_PASSWORD, role=User.Role.PATIENT
            )
            client = Client()
            login_as(client, patient)
            self.clients.append(client)

    def _book(self, client, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = client.post(
                "/bookings",
                {
                    "provider_id": self.provider.id,
                    "appointment_type_id": self.appointment_type.id,
                    "start_time": self.start_time_iso,
                },
                content_type="application/json",
                **AJAX_HEADERS,
            )
        except Exception as exc:  # surfaced to the main thread's assertions below, not swallowed
            results[index] = exc
        finally:
            connection.close()

    def test_exactly_one_of_n_concurrent_requests_on_the_last_slot_succeeds(self):
        barrier = threading.Barrier(CONCURRENT_REQUESTS)
        results = [None] * CONCURRENT_REQUESTS
        threads = [
            threading.Thread(target=self._book, args=(self.clients[i], barrier, results, i))
            for i in range(CONCURRENT_REQUESTS)
        ]

        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        for thread in threads:
            self.assertFalse(thread.is_alive(), "a concurrent booking request hung")
        for index, result in enumerate(results):
            self.assertNotIsInstance(result, Exception, f"thread {index} raised: {result!r}")

        statuses = [result.status_code for result in results]
        # The critical assertion: never a hang, never a 500, never two
        # confirmed bookings -- exactly one 201 (confirmed), every other
        # request cleanly rejected as a 409 conflict.
        self.assertEqual(statuses.count(201), 1, statuses)
        self.assertEqual(statuses.count(409), CONCURRENT_REQUESTS - 1, statuses)
        self.assertTrue(all(status in (201, 409) for status in statuses), statuses)

        all_bookings_for_slot = Booking.objects.filter(
            provider=self.provider, start_time=self.start_time
        )
        self.assertEqual(all_bookings_for_slot.count(), 1)
        winner = all_bookings_for_slot.get()
        self.assertEqual(winner.status, Booking.Status.CONFIRMED)

        winning_response = next(r for r in results if r.status_code == 201)
        self.assertEqual(winning_response.json()["id"], winner.id)
        self.assertEqual(winning_response.json()["status"], "confirmed")


CONCURRENT_RETRIES = 5


class ConcurrentIdempotentRetryTests(TransactionTestCase):
    """A genuinely simultaneous double-submit of the *same* request (not
    N different patients -- one patient's own client firing the same
    retried request, with the same client-generated `Idempotency-Key`,
    before the first attempt's response has come back). Every attempt must
    resolve to the *same* confirmed booking -- a 409 here would be wrong,
    since these aren't competitors for the slot, they're retries of one
    request (this ticket's point 4). Exercises
    `bookings.services.create_booking`'s `IntegrityError` recovery branch:
    two inserts can race past the initial "does a row with this key
    already exist" check before either commits, so the *second* insert's
    conflict has to be resolved after the fact, not prevented up front.
    """

    def setUp(self):
        self.provider = User.objects.create_user(
            email="provider2@example.com",
            password=TEST_PASSWORD,
            role=User.Role.PROVIDER,
            timezone="UTC",
        )
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="10:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.start_time_iso = "2026-08-17T09:00:00Z"

        self.patient = User.objects.create_user(
            email="retry-patient@example.com", password=TEST_PASSWORD, role=User.Role.PATIENT
        )
        self.clients = []
        for _ in range(CONCURRENT_RETRIES):
            client = Client()
            login_as(client, self.patient)
            self.clients.append(client)

    def _book(self, client, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = client.post(
                "/bookings",
                {
                    "provider_id": self.provider.id,
                    "appointment_type_id": self.appointment_type.id,
                    "start_time": self.start_time_iso,
                },
                content_type="application/json",
                HTTP_IDEMPOTENCY_KEY="same-retry-key",
                **AJAX_HEADERS,
            )
        except Exception as exc:
            results[index] = exc
        finally:
            connection.close()

    def test_concurrent_retries_of_the_same_idempotency_key_all_resolve_to_one_booking(self):
        barrier = threading.Barrier(CONCURRENT_RETRIES)
        results = [None] * CONCURRENT_RETRIES
        threads = [
            threading.Thread(target=self._book, args=(self.clients[i], barrier, results, i))
            for i in range(CONCURRENT_RETRIES)
        ]

        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        for index, result in enumerate(results):
            self.assertNotIsInstance(result, Exception, f"thread {index} raised: {result!r}")

        statuses = [result.status_code for result in results]
        self.assertEqual(statuses, [201] * CONCURRENT_RETRIES, statuses)

        booking_ids = {result.json()["id"] for result in results}
        self.assertEqual(len(booking_ids), 1)
        matching = Booking.objects.filter(
            provider=self.provider, idempotency_key="same-retry-key"
        )
        self.assertEqual(matching.count(), 1)
