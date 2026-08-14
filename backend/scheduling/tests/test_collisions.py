"""Unit tests for `scheduling.collisions` -- the core collision-detection
functions (project.md edge case 3). Exercised directly (not through the
HTTP seam), same convention as
`test_slots.py`/`scheduling.slots.get_open_slots`; API-level tests live in
`test_schedule_api.py` and the `BlockedTimeListCreateView` tests in
`test_blocked_time_api.py`.
"""

from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone

from bookings.models import Booking
from scheduling.collisions import (
    DEFAULT_HORIZON_DAYS,
    find_blocked_time_collisions,
    find_schedule_collisions,
)
from scheduling.models import AppointmentType, Availability

from .helpers import SchedulingAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


def _t(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


class HorizonConstantTests(SchedulingAPITestCase):
    def test_default_horizon_days_is_133(self):
        self.assertEqual(DEFAULT_HORIZON_DAYS, 133)


def _window(day_of_week, start_time, end_time):
    # `datetime.time` objects -- what `ScheduleWindowSerializer` actually
    # hands `find_schedule_collisions` once a request has gone through
    # DRF's `TimeField`; this unit-test seam calls the function directly,
    # so it has to build the same shape by hand.
    return {"day_of_week": day_of_week, "start_time": _t(start_time), "end_time": _t(end_time)}


def _single_generation(windows):
    # A timeline with only the baseline generation -- the shape a plain
    # "replace my live hours, no pending change exists" write produces.
    return [(None, windows)]


# Monday 2026-08-17 09:00-10:00 UTC -- the one active booking most tests in
# this file check the proposed change against.
MONDAY_BOOKING_START = _utc(2026, 8, 17, 9, 0)


class FindScheduleCollisionsTests(SchedulingAPITestCase):
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

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

    def test_a_shrink_that_excludes_the_booking_start_is_a_collision(self):
        # New Monday hours start at 10:00 -- the 09:00 booking is now before
        # the window opens.
        windows = [_window(0, "10:00", "17:00")]

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
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

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
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

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_a_non_active_booking_never_appears(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])
        windows = [_window(0, "10:00", "17:00")]

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
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
        collisions = find_schedule_collisions(
            self.provider, _single_generation([]), now=_utc(2026, 8, 1), horizon_days=90
        )

        self.assertEqual([entry["id"] for entry in collisions], [self.booking.id])

    def test_default_horizon_includes_booking_at_plus_120_days(self):
        now = _utc(2026, 8, 1)
        far_future_start = now + timedelta(days=120)
        far_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=far_future_start,
        )
        # Empty proposed set: every active booking within the default
        # 133-day horizon is a collision.
        collisions = find_schedule_collisions(
            self.provider, _single_generation([]), now=now
        )

        self.assertIn(far_booking.id, [entry["id"] for entry in collisions])

    def test_default_horizon_excludes_booking_at_plus_134_days(self):
        now = _utc(2026, 8, 1)
        beyond_horizon_start = now + timedelta(days=134)
        beyond_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=beyond_horizon_start,
        )
        collisions = find_schedule_collisions(
            self.provider, _single_generation([]), now=now
        )

        self.assertNotIn(beyond_booking.id, [entry["id"] for entry in collisions])

    def test_multiple_windows_on_the_same_day_can_jointly_cover_a_booking(self):
        # A single day split into a morning and afternoon window (e.g. a
        # lunch break) -- as long as one of them covers the booking, it's
        # not a collision.
        windows = [_window(0, "07:00", "08:30"), _window(0, "08:45", "12:00")]

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

    def test_a_booking_that_would_span_local_midnight_never_counts_as_covered(self):
        # A pathological same-day window can never "cover" a booking whose
        # local start/end land on two different calendar dates -- mirrors
        # `get_open_slots` never generating a slot that spans midnight.
        # 23:30-00:30 -- the fixed 60-minute span still crosses local
        # midnight, which is all this test needs.
        overnight_booking = self.create_booking(
            provider=self.provider,
            appointment_type=AppointmentType.objects.create(
                provider=self.provider, name="Overnight Watch"
            ),
            start_time=_utc(2026, 8, 17, 23, 30),
        )
        windows = [_window(0, "00:00", "23:59"), _window(1, "00:00", "23:59")]

        collisions = find_schedule_collisions(
            self.provider, _single_generation(windows), now=_utc(2026, 8, 1)
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

        collisions = find_schedule_collisions(
            provider, _single_generation(windows), now=_utc(2026, 8, 1)
        )

        self.assertEqual(collisions, [])

        # Narrowing the local window to start at 10:00 now excludes the
        # 09:00-local booking.
        narrower_windows = [_window(0, "10:00", "12:00")]
        collisions = find_schedule_collisions(
            provider, _single_generation(narrower_windows), now=_utc(2026, 8, 1)
        )
        self.assertEqual([entry["id"] for entry in collisions], [booking.id])


class FindScheduleCollisionsMultiGenerationTests(SchedulingAPITestCase):
    """Each booking is checked against the generation effective on *its
    own* provider-local date -- the seam that makes editing live hours
    safe while a pending change exists, and vice versa."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        # Two Monday 09:00 bookings a week apart, straddling a pending
        # change that takes effect on Thursday 2026-08-20.
        self.before_boundary = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
        )
        self.after_boundary = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 24, 9, 0),
        )
        self.boundary = date(2026, 8, 20)

    def test_each_booking_is_checked_against_the_generation_governing_its_date(self):
        # Live hours cover 09:00 Mondays; the pending generation doesn't.
        # Only the booking on/after the boundary collides.
        timeline = [
            (None, [_window(0, "09:00", "17:00")]),
            (self.boundary, [_window(0, "10:00", "17:00")]),
        ]

        collisions = find_schedule_collisions(self.provider, timeline, now=_utc(2026, 8, 1))

        self.assertEqual(
            [entry["id"] for entry in collisions], [self.after_boundary.id]
        )

    def test_a_booking_before_the_boundary_is_governed_by_the_live_generation(self):
        # Mirror image: the live hours shrink but the pending generation
        # still covers 09:00 -- only the pre-boundary booking collides.
        timeline = [
            (None, [_window(0, "10:00", "17:00")]),
            (self.boundary, [_window(0, "09:00", "17:00")]),
        ]

        collisions = find_schedule_collisions(self.provider, timeline, now=_utc(2026, 8, 1))

        self.assertEqual(
            [entry["id"] for entry in collisions], [self.before_boundary.id]
        )

    def test_a_booking_exactly_on_the_effective_date_uses_the_new_generation(self):
        # Thursday 2026-08-20 09:00, the boundary date itself -- "on/after"
        # means the new generation governs it.
        boundary_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 20, 9, 0),
        )
        timeline = [
            (None, [_window(0, "09:00", "17:00"), _window(3, "09:00", "17:00")]),
            (self.boundary, [_window(0, "09:00", "17:00"), _window(3, "10:00", "17:00")]),
        ]

        collisions = find_schedule_collisions(self.provider, timeline, now=_utc(2026, 8, 1))

        self.assertEqual([entry["id"] for entry in collisions], [boundary_booking.id])

    def test_generation_windows_may_be_availability_rows_not_just_dicts(self):
        # `proposed_timeline` folds the untouched generation in as saved
        # `Availability` rows -- coverage checks read them identically.
        # Re-fetched so the row carries real `datetime.time`s, exactly as
        # a queryset read would hand them over.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        rows = list(Availability.objects.filter(provider=self.provider))
        timeline = [(None, rows), (self.boundary, [_window(0, "09:00", "17:00")])]

        collisions = find_schedule_collisions(self.provider, timeline, now=_utc(2026, 8, 1))

        self.assertEqual(collisions, [])


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

    def test_default_horizon_includes_booking_at_plus_120_days_when_blocked(self):
        now = _utc(2026, 8, 1)
        far_future_start = now + timedelta(days=120)
        far_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=far_future_start,
        )

        collisions = find_blocked_time_collisions(
            self.provider,
            far_future_start,
            far_future_start + timedelta(hours=2),
            now=now,
        )

        self.assertEqual([entry["id"] for entry in collisions], [far_booking.id])

    def test_default_horizon_excludes_booking_at_plus_134_days_when_blocked(self):
        now = _utc(2026, 8, 1)
        beyond_horizon_start = now + timedelta(days=134)
        beyond_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=beyond_horizon_start,
        )

        collisions = find_blocked_time_collisions(
            self.provider,
            beyond_horizon_start,
            beyond_horizon_start + timedelta(hours=2),
            now=now,
        )

        self.assertEqual(collisions, [])
        self.assertIsNotNone(beyond_booking.id)  # sanity: row exists, just excluded
