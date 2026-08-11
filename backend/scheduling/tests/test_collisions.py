"""Unit tests for `scheduling.collisions` -- the core collision-detection
functions this ticket builds (TICKET-11, project.md edge case 3). Exercised
directly (not through the HTTP seam), same convention as
`test_slots.py`/`scheduling.slots.get_open_slots`; API-level tests live in
`test_availability_collision_api.py` and the `BlockedTimeListCreateView`
tests in `test_blocked_time_api.py`.
"""

from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from bookings.models import Booking
from scheduling.collisions import find_availability_collisions, find_blocked_time_collisions
from scheduling.models import AppointmentType

from .helpers import SchedulingAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


def _t(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


def _window(day_of_week, start_time, end_time):
    # `datetime.time` objects -- what `ProposedAvailabilityWindowSerializer`
    # actually hands `find_availability_collisions` once a request has gone
    # through DRF's `TimeField`; this unit-test seam calls the function
    # directly, so it has to build the same shape by hand.
    return {"day_of_week": day_of_week, "start_time": _t(start_time), "end_time": _t(end_time)}


# Monday 2026-08-17 09:00-10:00 UTC -- the one active booking most tests in
# this file check the proposed change against.
MONDAY_BOOKING_START = _utc(2026, 8, 17, 9, 0)


class FindAvailabilityCollisionsTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=MONDAY_BOOKING_START,
        )

    def test_a_window_that_still_covers_the_booking_is_not_a_collision(self):
        # Shrinks Monday from a wider range down to one that still spans
        # 09:00-10:00 -- the booking survives the edit untouched.
        windows = [_window(0, "08:00", "12:00")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

    def test_a_shrink_that_excludes_the_booking_start_is_a_collision(self):
        # New Monday hours start at 10:00 -- the 09:00 booking is now before
        # the window opens.
        windows = [_window(0, "10:00", "17:00")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual(len(collisions), 1)
        entry = collisions[0]
        self.assertEqual(entry["id"], self.booking.id)
        self.assertEqual(entry["start_time"], MONDAY_BOOKING_START)
        self.assertEqual(entry["end_time"], MONDAY_BOOKING_START + timedelta(hours=1))
        self.assertEqual(entry["patient_name"], self.booking.patient.name)
        self.assertEqual(entry["appointment_type_name"], "Follow-up")
        self.assertEqual(entry["status"], Booking.Status.CONFIRMED)

    def test_removing_the_day_entirely_is_a_collision(self):
        # Monday is simply absent from the proposed set -- every active
        # Monday booking is now unaddressed by any window.
        windows = [_window(1, "09:00", "17:00")]  # Tuesday only

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_a_booking_on_an_unaffected_day_is_never_a_collision(self):
        other_booking_start = _utc(2026, 8, 18, 9, 0)  # Tuesday
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=other_booking_start,
        )
        # Shrink Monday only -- Tuesday's proposed window is unchanged and
        # still covers the Tuesday booking.
        windows = [_window(0, "10:00", "17:00"), _window(1, "09:00", "17:00")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_a_non_active_booking_never_appears(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])
        windows = [_window(0, "10:00", "17:00")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

    def test_a_booking_beyond_the_horizon_is_excluded(self):
        far_future_start = MONDAY_BOOKING_START + timedelta(days=120)
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=far_future_start,
        )
        # Empty proposed set: everything within-horizon is a collision, but
        # the far-future booking sits outside the 90-day horizon.
        collisions = find_availability_collisions(
            self.provider, [], now=_utc(2026, 8, 1), horizon_days=90
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_multiple_windows_on_the_same_day_can_jointly_cover_a_booking(self):
        # A single day split into a morning and afternoon window (e.g. a
        # lunch break) -- as long as one of them covers the booking, it's
        # not a collision.
        windows = [_window(0, "07:00", "08:30"), _window(0, "08:45", "12:00")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

    def test_a_booking_that_would_span_local_midnight_never_counts_as_covered(self):
        # A pathological same-day window can never "cover" a booking whose
        # local start/end land on two different calendar dates -- mirrors
        # `get_open_slots` never generating a slot that spans midnight.
        overnight_booking = self.create_booking(
            provider=self.provider,
            appointment_type=AppointmentType.objects.create(
                provider=self.provider, name="Overnight Watch", duration_minutes=120
            ),
            start_time=_utc(2026, 8, 17, 23, 30),
        )
        windows = [_window(0, "00:00", "23:59"), _window(1, "00:00", "23:59")]

        collisions = find_availability_collisions(
            self.provider, windows, now=_utc(2026, 8, 1)
        )

        self.assertIn(overnight_booking.id, [entry["id"] for entry in collisions])

    def test_respects_the_providers_own_timezone(self):
        provider = self.create_provider(
            email="ny-provider@example.com", timezone="America/New_York"
        )
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up", duration_minutes=60
        )
        # 13:00 UTC on a Monday in August is 09:00 America/New_York (EDT,
        # UTC-4) -- well inside a proposed 08:00-12:00 local window.
        booking = self.create_booking(
            provider=provider,
            appointment_type=appointment_type,
            start_time=_utc(2026, 8, 17, 13, 0),
        )
        windows = [_window(0, "08:00", "12:00")]

        collisions = find_availability_collisions(provider, windows, now=_utc(2026, 8, 1))

        self.assertEqual(collisions, [])

        # Narrowing the local window to start at 10:00 now excludes the
        # 09:00-local booking.
        narrower_windows = [_window(0, "10:00", "12:00")]
        collisions = find_availability_collisions(provider, narrower_windows, now=_utc(2026, 8, 1))
        self.assertEqual([entry["id"] for entry in collisions], [booking.id])


class FindBlockedTimeCollisionsTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=MONDAY_BOOKING_START,
        )

    def test_a_block_that_does_not_overlap_the_booking_is_not_a_collision(self):
        collisions = find_blocked_time_collisions(
            self.provider,
            _utc(2026, 8, 17, 11, 0),
            _utc(2026, 8, 17, 12, 0),
            now=_utc(2026, 8, 1),
        )

        self.assertEqual(collisions, [])

    def test_a_block_that_fully_contains_the_booking_is_a_collision(self):
        collisions = find_blocked_time_collisions(
            self.provider,
            _utc(2026, 8, 17, 0, 0),
            _utc(2026, 8, 18, 0, 0),
            now=_utc(2026, 8, 1),
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_a_block_that_partially_overlaps_the_booking_is_a_collision(self):
        # Block runs 09:30-11:00 -- overlaps the last half of the 09:00-10:00
        # booking without containing it.
        collisions = find_blocked_time_collisions(
            self.provider,
            _utc(2026, 8, 17, 9, 30),
            _utc(2026, 8, 17, 11, 0),
            now=_utc(2026, 8, 1),
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_a_block_that_ends_exactly_when_the_booking_starts_is_not_a_collision(self):
        collisions = find_blocked_time_collisions(
            self.provider,
            _utc(2026, 8, 17, 8, 0),
            MONDAY_BOOKING_START,
            now=_utc(2026, 8, 1),
        )

        self.assertEqual(collisions, [])

    def test_a_non_active_booking_never_appears(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])

        collisions = find_blocked_time_collisions(
            self.provider,
            _utc(2026, 8, 17, 0, 0),
            _utc(2026, 8, 18, 0, 0),
            now=_utc(2026, 8, 1),
        )

        self.assertEqual(collisions, [])

    def test_a_booking_beyond_the_horizon_is_excluded(self):
        far_future_start = MONDAY_BOOKING_START + timedelta(days=120)
        far_future_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=far_future_start,
        )

        collisions = find_blocked_time_collisions(
            self.provider,
            far_future_start,
            far_future_start + timedelta(hours=2),
            now=_utc(2026, 8, 1),
            horizon_days=90,
        )

        self.assertEqual(collisions, [])
        self.assertIsNotNone(far_future_booking.id)  # sanity: row exists, just excluded
