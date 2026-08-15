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
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client, TransactionTestCase

from accounts.tests.helpers import TEST_PASSWORD
from audit.tests.helpers import login_as
from bookings.models import Booking
from scheduling.models import AppointmentType, Availability

from .helpers import BookingsAPITestCase

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


class ConcurrentRescheduleTests(TransactionTestCase):
    """TICKET-10's own version of this ticket's race: `CONCURRENT_REQUESTS`
    different patients, each already holding their *own* confirmed booking
    at a distinct original time, all attempt to reschedule into the exact
    same target slot at (as close as a `threading.Barrier` can get) the
    same instant. Same guard, same guarantee as `ConcurrentBookingTests`
    above -- exactly one winner -- because
    `bookings.services.reschedule_booking` reuses `_book_open_slot`'s
    Layer 1 `select_for_update()` + Layer 2 partial `UniqueConstraint`
    guard against the new slot, not a second, separately-maintained
    implementation of it.

    Each patient's own original booking sits at a distinct hour
    (10:00-19:00), well outside the shared 09:00-10:00 target window, so
    the only real contention in this test is for the target slot itself --
    not an artifact of all ten patients' `select_for_update()` calls also
    fighting over unrelated rows.
    """

    def setUp(self):
        self.provider = User.objects.create_user(
            email="reschedule-provider@example.com",
            password=TEST_PASSWORD,
            role=User.Role.PROVIDER,
            timezone="UTC",
        )
        # 09:00-20:00 covers eleven one-hour slots: 09:00 is the shared
        # target every thread races for, 10:00-19:00 are the ten patients'
        # own distinct original bookings.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="20:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        # 2026-08-17 is a Monday, matching day_of_week=0 above.
        self.target_start_iso = "2026-08-17T09:00:00Z"
        self.target_start = datetime(2026, 8, 17, 9, 0, tzinfo=dt_timezone.utc)

        self.clients = []
        self.booking_ids = []
        for i in range(CONCURRENT_REQUESTS):
            patient = User.objects.create_user(
                email=f"reschedule-patient{i}@example.com",
                password=TEST_PASSWORD,
                role=User.Role.PATIENT,
            )
            original_start = datetime(2026, 8, 17, 10 + i, 0, tzinfo=dt_timezone.utc)
            booking = Booking.objects.create(
                provider=self.provider,
                patient=patient,
                appointment_type=self.appointment_type,
                start_time=original_start,
                end_time=original_start + timedelta(hours=1),
                status=Booking.Status.CONFIRMED,
            )
            self.booking_ids.append(booking.id)
            client = Client()
            login_as(client, patient)
            self.clients.append(client)

    def _reschedule(self, client, booking_id, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = client.patch(
                f"/bookings/{booking_id}/reschedule",
                {"start_time": self.target_start_iso},
                content_type="application/json",
                **AJAX_HEADERS,
            )
        except Exception as exc:  # surfaced to the main thread's assertions below, not swallowed
            results[index] = exc
        finally:
            connection.close()

    def test_exactly_one_of_n_concurrent_reschedules_onto_the_same_target_slot_succeeds(self):
        barrier = threading.Barrier(CONCURRENT_REQUESTS)
        results = [None] * CONCURRENT_REQUESTS
        threads = [
            threading.Thread(
                target=self._reschedule,
                args=(self.clients[i], self.booking_ids[i], barrier, results, i),
            )
            for i in range(CONCURRENT_REQUESTS)
        ]

        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        for thread in threads:
            self.assertFalse(thread.is_alive(), "a concurrent reschedule request hung")
        for index, result in enumerate(results):
            self.assertNotIsInstance(result, Exception, f"thread {index} raised: {result!r}")

        statuses = [result.status_code for result in results]
        # The critical assertion, mirroring `ConcurrentBookingTests` above:
        # never a hang, never a 500, never two confirmed bookings at the
        # target slot -- exactly one 200 (confirmed), every other request
        # cleanly rejected as a 409 conflict.
        self.assertEqual(statuses.count(200), 1, statuses)
        self.assertEqual(statuses.count(409), CONCURRENT_REQUESTS - 1, statuses)
        self.assertTrue(all(s in (200, 409) for s in statuses), statuses)

        winners_at_target = Booking.objects.filter(
            provider=self.provider, start_time=self.target_start, status=Booking.Status.CONFIRMED
        )
        self.assertEqual(winners_at_target.count(), 1)

        winning_index = statuses.index(200)
        winning_original = Booking.objects.get(pk=self.booking_ids[winning_index])
        self.assertEqual(winning_original.status, Booking.Status.CANCELLED)

        # Every losing thread's *own* original booking is untouched -- a
        # lost race for the target slot must not cancel (or otherwise
        # mutate) the booking that thread was trying to move.
        for index, booking_id in enumerate(self.booking_ids):
            if index == winning_index:
                continue
            loser_original = Booking.objects.get(pk=booking_id)
            self.assertEqual(loser_original.status, Booking.Status.CONFIRMED)

        winning_body = results[winning_index].json()
        self.assertEqual(winning_body["id"], winners_at_target.get().id)
        self.assertEqual(winning_body["previous_booking_id"], self.booking_ids[winning_index])


class ConcurrentRescheduleVersusFreshBookingTests(TransactionTestCase):
    """The other half of this ticket's race scenario ("a reschedule racing
    another patient for the target slot" -- the brief's own alternative
    phrasing is "one reschedule racing a fresh `POST /bookings`"): a
    reschedule isn't only racing other reschedules for the target slot, it
    is racing plain new-booking attempts on that same slot too, and the
    guard has to resolve that exactly the same way `_book_open_slot` being
    the one shared implementation both call paths run through.
    """

    def setUp(self):
        self.provider = User.objects.create_user(
            email="mixed-race-provider@example.com",
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
        self.target_start_iso = "2026-08-17T09:00:00Z"
        self.target_start = datetime(2026, 8, 17, 9, 0, tzinfo=dt_timezone.utc)

        # This fixture's only working-hours window *is* the target slot
        # itself, so the rescheduling patient's pre-existing booking has to
        # be created directly (bypassing `create_booking`'s own open-slot
        # check, same as `bookings.tests.helpers.BookingsAPITestCase
        # .make_booking` does) rather than through a real `POST /bookings`
        # call -- it lives at an arbitrary distant time nothing else here
        # touches.
        self.rescheduling_patient = User.objects.create_user(
            email="mixed-race-reschedule-patient@example.com",
            password=TEST_PASSWORD,
            role=User.Role.PATIENT,
        )
        self.original_booking = Booking.objects.create(
            provider=self.provider,
            patient=self.rescheduling_patient,
            appointment_type=self.appointment_type,
            start_time=datetime(2099, 1, 4, 9, 0, tzinfo=dt_timezone.utc),
            end_time=datetime(2099, 1, 4, 10, 0, tzinfo=dt_timezone.utc),
            status=Booking.Status.CONFIRMED,
        )
        self.reschedule_client = Client()
        login_as(self.reschedule_client, self.rescheduling_patient)

        self.fresh_booking_clients = []
        for i in range(CONCURRENT_REQUESTS - 1):
            patient = User.objects.create_user(
                email=f"mixed-race-fresh-patient{i}@example.com",
                password=TEST_PASSWORD,
                role=User.Role.PATIENT,
            )
            client = Client()
            login_as(client, patient)
            self.fresh_booking_clients.append(client)

    def _reschedule(self, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = self.reschedule_client.patch(
                f"/bookings/{self.original_booking.id}/reschedule",
                {"start_time": self.target_start_iso},
                content_type="application/json",
                **AJAX_HEADERS,
            )
        except Exception as exc:
            results[index] = exc
        finally:
            connection.close()

    def _book_fresh(self, client, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = client.post(
                "/bookings",
                {
                    "provider_id": self.provider.id,
                    "appointment_type_id": self.appointment_type.id,
                    "start_time": self.target_start_iso,
                },
                content_type="application/json",
                **AJAX_HEADERS,
            )
        except Exception as exc:
            results[index] = exc
        finally:
            connection.close()

    def test_a_reschedule_racing_fresh_bookings_for_the_same_slot_has_exactly_one_winner(self):
        barrier = threading.Barrier(CONCURRENT_REQUESTS)
        results = [None] * CONCURRENT_REQUESTS
        threads = [threading.Thread(target=self._reschedule, args=(barrier, results, 0))]
        threads += [
            threading.Thread(target=self._book_fresh, args=(client, barrier, results, i + 1))
            for i, client in enumerate(self.fresh_booking_clients)
        ]

        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        for thread in threads:
            self.assertFalse(thread.is_alive(), "a concurrent request hung")
        for index, result in enumerate(results):
            self.assertNotIsInstance(result, Exception, f"thread {index} raised: {result!r}")

        statuses = [result.status_code for result in results]
        wins = sum(1 for code in statuses if code in (200, 201))
        self.assertEqual(wins, 1, statuses)
        self.assertEqual(statuses.count(409), CONCURRENT_REQUESTS - 1, statuses)

        confirmed_at_target = Booking.objects.filter(
            provider=self.provider, start_time=self.target_start, status=Booking.Status.CONFIRMED
        )
        self.assertEqual(confirmed_at_target.count(), 1)

        self.original_booking.refresh_from_db()
        reschedule_won = statuses[0] in (200, 201)
        expected_original_status = (
            Booking.Status.CANCELLED if reschedule_won else Booking.Status.CONFIRMED
        )
        self.assertEqual(self.original_booking.status, expected_original_status)


class MixedDurationConcurrentBookingTests(TransactionTestCase):
    """The race the exclusion constraints exist for. With a single
    60-minute duration on an aligned grid, any true overlap implies an
    identical `start_time`, so the partial unique indexes fully backstop
    the "two brand-new rows, nothing to lock yet" race the classes above
    exercise. With mixed 30/60 durations that stops being true: a
    60-minute booking at 09:00 and a 30-minute booking at 09:30 overlap
    *without* sharing a start_time -- Layer 1's `select_for_update` finds
    nothing committed to lock on either side, and neither unique index
    objects. Only `no_overlapping_active_booking_per_provider` (the
    btree_gist exclusion constraint over `TSTZRANGE(start_time,
    end_time)`) refuses the second insert. Dropping that constraint makes
    this test fail with two committed 201s -- verified once during its
    development.
    """

    def setUp(self):
        self.provider = User.objects.create_user(
            email="mixed-duration-provider@example.com",
            password=TEST_PASSWORD,
            role=User.Role.PROVIDER,
            timezone="UTC",
        )
        # One working hour: exactly enough room for either the single
        # 60-minute slot or two 30-minute ones -- the two racing requests
        # below are each individually valid against it.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="10:00"
        )
        self.hour_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.half_hour_type = AppointmentType.objects.create(
            provider=self.provider, name="Quick check", duration_minutes=30
        )
        # 2026-08-17 is a Monday, matching day_of_week=0 above.
        self.window_start = datetime(2026, 8, 17, 9, 0, tzinfo=dt_timezone.utc)
        self.window_end = datetime(2026, 8, 17, 10, 0, tzinfo=dt_timezone.utc)

        self.clients = []
        for i in range(2):
            patient = User.objects.create_user(
                email=f"mixed-duration-patient{i}@example.com",
                password=TEST_PASSWORD,
                role=User.Role.PATIENT,
            )
            client = Client()
            login_as(client, patient)
            self.clients.append(client)

    def _book(self, client, appointment_type, start_time_iso, barrier, results, index):
        try:
            barrier.wait(timeout=30)
            results[index] = client.post(
                "/bookings",
                {
                    "provider_id": self.provider.id,
                    "appointment_type_id": appointment_type.id,
                    "start_time": start_time_iso,
                },
                content_type="application/json",
                **AJAX_HEADERS,
            )
        except Exception as exc:  # surfaced to the main thread's assertions below, not swallowed
            results[index] = exc
        finally:
            connection.close()

    def test_a_60_minute_and_an_overlapping_30_minute_booking_have_exactly_one_winner(self):
        barrier = threading.Barrier(2)
        results = [None, None]
        threads = [
            threading.Thread(
                target=self._book,
                args=(
                    self.clients[0],
                    self.hour_type,
                    "2026-08-17T09:00:00Z",
                    barrier,
                    results,
                    0,
                ),
            ),
            threading.Thread(
                target=self._book,
                args=(
                    self.clients[1],
                    self.half_hour_type,
                    "2026-08-17T09:30:00Z",
                    barrier,
                    results,
                    1,
                ),
            ),
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
        # committed overlapping bookings -- exactly one 201, the other a
        # clean 409, whichever thread happens to win.
        self.assertEqual(sorted(statuses), [201, 409], statuses)

        overlapping_active = Booking.objects.filter(
            provider=self.provider,
            status__in=Booking.ACTIVE_STATUSES,
            start_time__lt=self.window_end,
            end_time__gt=self.window_start,
        )
        self.assertEqual(overlapping_active.count(), 1)
        winner = overlapping_active.get()
        self.assertEqual(winner.status, Booking.Status.CONFIRMED)
        winning_response = next(r for r in results if r.status_code == 201)
        self.assertEqual(winning_response.json()["id"], winner.id)


class MixedDurationSerialOverlapTests(BookingsAPITestCase):
    """The serial (non-race) half of the mixed-duration overlap rule: with
    a 60-minute booking already committed at 09:00, the 30-minute type's
    09:30 slot is neither offered by `GET /scheduling/slots` nor bookable
    through `POST /bookings` -- Layer 1 and the slot feed's busy-interval
    fold are both overlap-based, not start-time-based.
    """

    def setUp(self):
        self.provider, self.hour_type = self.setup_bookable_provider(timezone="UTC")
        self.half_hour_type = AppointmentType.objects.create(
            provider=self.provider, name="Quick check", duration_minutes=30
        )
        self.booked_patient = self.create_patient(email="booked-patient@example.com")
        self.other_patient = self.create_patient(email="other-patient@example.com")
        # 2026-08-17 is a Monday, matching setup_bookable_provider's
        # 09:00-17:00 Monday window.
        self.make_booking(
            provider=self.provider,
            patient=self.booked_patient,
            appointment_type=self.hour_type,
            start_time=datetime(2026, 8, 17, 9, 0, tzinfo=dt_timezone.utc),
        )

    def test_the_slot_feed_never_offers_a_30_minute_slot_inside_a_60_minute_booking(self):
        self.login_as(self.other_patient)

        response = self.client.get(
            "/scheduling/slots",
            {
                "provider_id": self.provider.id,
                "appointment_type_id": self.half_hour_type.id,
                "date_from": "2026-08-17",
                "date_to": "2026-08-17",
            },
        )

        self.assertEqual(response.status_code, 200)
        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertNotIn("2026-08-17T09:00:00Z", starts)
        self.assertNotIn("2026-08-17T09:30:00Z", starts)
        # The hour after the 60-minute booking is untouched: both of its
        # 30-minute slots are still offered.
        self.assertIn("2026-08-17T10:00:00Z", starts)
        self.assertIn("2026-08-17T10:30:00Z", starts)

    def test_booking_a_30_minute_slot_inside_a_60_minute_booking_is_rejected(self):
        self.login_as(self.other_patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.half_hour_type,
            start_time="2026-08-17T09:30:00Z",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            Booking.objects.filter(patient=self.other_patient).count(), 0
        )
