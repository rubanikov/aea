"""Unit tests for `scheduling.slots.get_open_slots` -- the core
slot-generation function this ticket builds. Exercised directly (not
through the HTTP seam) since this is where the ticket's ">=80% test
coverage on the generation function" requirement applies; API-level tests
live in `test_slots_api.py`.
"""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from scheduling.models import AppointmentType, Availability
from scheduling.slots import get_open_slots

from .helpers import SchedulingAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class NormalWeekTests(SchedulingAPITestCase):
    """Provider sets Mon-Fri 09:00-17:00 working hours; generated list
    reflects it correctly (ticket acceptance criterion #1)."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        for day in range(5):  # Monday(0) .. Friday(4)
            Availability.objects.create(
                provider=self.provider,
                day_of_week=day,
                start_time="09:00",
                end_time="17:00",
            )
        self.hourly = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )

    def test_generates_one_slot_per_hour_across_the_working_week(self):
        # Mon 2026-08-17 .. Sun 2026-08-23.
        slots = get_open_slots(
            self.provider,
            self.hourly,
            date(2026, 8, 17),
            date(2026, 8, 23),
            now=_utc(2026, 1, 1),
        )

        # 5 weekdays x 8 one-hour slots (09:00-17:00) = 40.
        self.assertEqual(len(slots), 40)
        self.assertEqual(slots[0].start, _utc(2026, 8, 17, 9, 0))
        self.assertEqual(slots[0].end, _utc(2026, 8, 17, 10, 0))
        self.assertEqual(slots[-1].start, _utc(2026, 8, 21, 16, 0))
        self.assertEqual(slots[-1].end, _utc(2026, 8, 21, 17, 0))

    def test_weekend_days_produce_no_slots(self):
        slots = get_open_slots(
            self.provider,
            self.hourly,
            date(2026, 8, 22),  # Saturday
            date(2026, 8, 23),  # Sunday
            now=_utc(2026, 1, 1),
        )

        self.assertEqual(slots, [])

    def test_slots_are_ordered_by_start_time(self):
        slots = get_open_slots(
            self.provider,
            self.hourly,
            date(2026, 8, 17),
            date(2026, 8, 23),
            now=_utc(2026, 1, 1),
        )

        starts = [slot.start for slot in slots]
        self.assertEqual(starts, sorted(starts))

    def test_defaults_now_to_the_real_current_time_when_not_supplied(self):
        # No `now=` passed -- exercises the `now is None` default branch.
        # A range entirely in the past (relative to whenever this test
        # actually runs) must come back empty.
        slots = get_open_slots(self.provider, self.hourly, date(2000, 1, 3), date(2000, 1, 4))

        self.assertEqual(slots, [])


class AppointmentTypeDurationTests(SchedulingAPITestCase):
    """A 15-minute Follow-up type produces 15-minute slots even though a
    45-minute New Patient Visit type exists on the same provider/day
    (ticket acceptance criterion #2)."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.follow_up = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=15
        )
        self.new_patient = AppointmentType.objects.create(
            provider=self.provider, name="New Patient Visit", duration_minutes=45
        )

    def test_shorter_duration_type_produces_more_smaller_slots(self):
        day = date(2026, 8, 17)
        follow_up_slots = get_open_slots(
            self.provider, self.follow_up, day, day, now=_utc(2026, 1, 1)
        )
        new_patient_slots = get_open_slots(
            self.provider, self.new_patient, day, day, now=_utc(2026, 1, 1)
        )

        # 8 hours = 480 minutes: 480/15 = 32 exact slots.
        self.assertEqual(len(follow_up_slots), 32)
        self.assertEqual(
            follow_up_slots[1].start - follow_up_slots[0].start, timedelta(minutes=15)
        )
        # 480/45 = 10 full slots with 30 minutes left over (no partial slot).
        self.assertEqual(len(new_patient_slots), 10)
        self.assertEqual(
            new_patient_slots[1].start - new_patient_slots[0].start, timedelta(minutes=45)
        )
        self.assertEqual(new_patient_slots[-1].end, _utc(2026, 8, 17, 16, 30))
        self.assertNotEqual(len(follow_up_slots), len(new_patient_slots))


class PastTimeFilteringTests(SchedulingAPITestCase):
    """Past times never appear as bookable (ticket acceptance criterion
    #3)."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )

    def test_slots_before_now_are_excluded(self):
        # "Now" lands mid-morning on the only day in range -- only the
        # slots at/after that instant should survive.
        now = _utc(2026, 8, 17, 11, 30)

        slots = get_open_slots(
            self.provider, self.appointment_type, date(2026, 8, 17), date(2026, 8, 17), now=now
        )

        self.assertTrue(all(slot.start >= now for slot in slots))
        self.assertEqual(slots[0].start, _utc(2026, 8, 17, 12, 0))

    def test_entire_past_day_produces_no_slots(self):
        now = _utc(2026, 8, 18, 0, 0)

        slots = get_open_slots(
            self.provider, self.appointment_type, date(2026, 8, 17), date(2026, 8, 17), now=now
        )

        self.assertEqual(slots, [])


class EmptyStateTests(SchedulingAPITestCase):
    """A provider with no availability configured produces an empty list,
    not an error (ticket acceptance criterion #6)."""

    def test_no_availability_rows_produces_no_slots(self):
        provider = self.create_provider(timezone="UTC")
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up", duration_minutes=30
        )

        slots = get_open_slots(
            provider, appointment_type, date(2026, 8, 17), date(2026, 8, 23), now=_utc(2026, 1, 1)
        )

        self.assertEqual(slots, [])


class MultipleWindowsPerDayTests(SchedulingAPITestCase):
    """Two non-contiguous availability windows on the same day (e.g. a
    lunch break) never bridge into one slot spanning the gap."""

    def test_gap_between_windows_is_never_bookable(self):
        provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=provider, day_of_week=0, start_time="09:00", end_time="12:00"
        )
        Availability.objects.create(
            provider=provider, day_of_week=0, start_time="13:00", end_time="17:00"
        )
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up", duration_minutes=60
        )

        slots = get_open_slots(
            provider, appointment_type, date(2026, 8, 17), date(2026, 8, 17), now=_utc(2026, 1, 1)
        )

        self.assertEqual(len(slots), 7)  # 3 morning + 4 afternoon
        morning_end = _utc(2026, 8, 17, 12, 0)
        afternoon_start = _utc(2026, 8, 17, 13, 0)
        self.assertTrue(
            all(slot.end <= morning_end or slot.start >= afternoon_start for slot in slots)
        )


class BusyIntervalsSeamTests(SchedulingAPITestCase):
    """The TICKET-07 integration seam: any slot overlapping a supplied busy
    interval is dropped; everything else survives untouched."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="12:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )

    def test_no_busy_intervals_returns_every_computed_slot(self):
        slots = get_open_slots(
            self.provider,
            self.appointment_type,
            date(2026, 8, 17),
            date(2026, 8, 17),
            now=_utc(2026, 1, 1),
        )

        self.assertEqual(len(slots), 3)

    def test_an_overlapping_busy_interval_removes_only_that_slot(self):
        busy = [(_utc(2026, 8, 17, 10, 0), _utc(2026, 8, 17, 11, 0))]

        slots = get_open_slots(
            self.provider,
            self.appointment_type,
            date(2026, 8, 17),
            date(2026, 8, 17),
            busy_intervals=busy,
            now=_utc(2026, 1, 1),
        )

        starts = [slot.start for slot in slots]
        self.assertEqual(starts, [_utc(2026, 8, 17, 9, 0), _utc(2026, 8, 17, 11, 0)])

    def test_a_partially_overlapping_busy_interval_still_removes_the_slot(self):
        # Busy 10:30-10:45 doesn't fully cover the 10:00-11:00 slot but
        # does overlap it -- the whole slot is unbookable, not just part.
        busy = [(_utc(2026, 8, 17, 10, 30), _utc(2026, 8, 17, 10, 45))]

        slots = get_open_slots(
            self.provider,
            self.appointment_type,
            date(2026, 8, 17),
            date(2026, 8, 17),
            busy_intervals=busy,
            now=_utc(2026, 1, 1),
        )

        starts = [slot.start for slot in slots]
        self.assertNotIn(_utc(2026, 8, 17, 10, 0), starts)
        self.assertEqual(len(slots), 2)


class DstSpringForwardTests(SchedulingAPITestCase):
    """The single most important test in this ticket. America/New_York
    springs forward on 2026-03-08: 01:59:59 EST is immediately followed by
    03:00:00 EDT (clocks skip 2:00-2:59 entirely -- a 23-hour day). A
    01:00-04:00 local availability window therefore spans only 2 real
    hours, not the naive 3 -- verified against real Postgres/`zoneinfo`
    dates computed directly from `ZoneInfo("America/New_York")`, not
    guessed.
    """

    def setUp(self):
        self.provider = self.create_provider(timezone="America/New_York")
        # 2026-03-08 is a Sunday -- Availability.DayOfWeek.SUNDAY == 6.
        Availability.objects.create(
            provider=self.provider,
            day_of_week=Availability.DayOfWeek.SUNDAY,
            start_time="01:00",
            end_time="04:00",
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=30
        )

    def test_slot_count_and_boundaries_reflect_the_lost_hour_not_naive_local_math(self):
        slots = get_open_slots(
            self.provider,
            self.appointment_type,
            date(2026, 3, 8),
            date(2026, 3, 8),
            now=_utc(2026, 1, 1),
        )

        # Naive local math (04:00 - 01:00 = 3h) would wrongly produce 6
        # slots. The real elapsed UTC span is 2 hours (01:00 EST == 06:00
        # UTC; 04:00 EDT == 08:00 UTC) -- exactly 4 slots of 30 minutes.
        self.assertEqual(len(slots), 4)
        self.assertEqual(slots[0].start, _utc(2026, 3, 8, 6, 0))
        self.assertEqual(slots[-1].end, _utc(2026, 3, 8, 8, 0))
        # No duplicated or skipped boundaries: consecutive slots are
        # contiguous, and the run is exactly the pre-computed instant list.
        expected_starts = [
            _utc(2026, 3, 8, 6, 0),
            _utc(2026, 3, 8, 6, 30),
            _utc(2026, 3, 8, 7, 0),
            _utc(2026, 3, 8, 7, 30),
        ]
        self.assertEqual([slot.start for slot in slots], expected_starts)


class DstFallBackTests(SchedulingAPITestCase):
    """America/New_York falls back on 2026-11-01: 01:59:59 EDT is followed
    by 01:00:00 EST -- the 1 o'clock hour happens twice (a 25-hour day). A
    00:30-02:30 local availability window spans 3 real hours, not the
    naive 2.
    """

    def setUp(self):
        self.provider = self.create_provider(timezone="America/New_York")
        # 2026-11-01 is also a Sunday.
        Availability.objects.create(
            provider=self.provider,
            day_of_week=Availability.DayOfWeek.SUNDAY,
            start_time="00:30",
            end_time="02:30",
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=30
        )

    def test_slot_count_and_boundaries_reflect_the_repeated_hour_not_naive_local_math(self):
        slots = get_open_slots(
            self.provider,
            self.appointment_type,
            date(2026, 11, 1),
            date(2026, 11, 1),
            now=_utc(2026, 1, 1),
        )

        # Naive local math (02:30 - 00:30 = 2h) would wrongly produce 4
        # slots. The real elapsed UTC span is 3 hours (00:30 EDT == 04:30
        # UTC; 02:30 EST == 07:30 UTC) -- exactly 6 slots of 30 minutes.
        self.assertEqual(len(slots), 6)
        self.assertEqual(slots[0].start, _utc(2026, 11, 1, 4, 30))
        self.assertEqual(slots[-1].end, _utc(2026, 11, 1, 7, 30))
        expected_starts = [
            _utc(2026, 11, 1, 4, 30),
            _utc(2026, 11, 1, 5, 0),
            _utc(2026, 11, 1, 5, 30),
            _utc(2026, 11, 1, 6, 0),
            _utc(2026, 11, 1, 6, 30),
            _utc(2026, 11, 1, 7, 0),
        ]
        self.assertEqual([slot.start for slot in slots], expected_starts)


class TimezoneConversionTests(SchedulingAPITestCase):
    """Confirms slot instants are actually correct UTC conversions of a
    non-UTC provider timezone outside of any DST transition (a plain
    sanity check independent of the DST-specific tests above)."""

    def test_non_utc_provider_timezone_converts_correctly(self):
        provider = self.create_provider(timezone="America/Chicago")  # UTC-5 in August (CDT)
        Availability.objects.create(
            provider=provider, day_of_week=0, start_time="09:00", end_time="10:00"
        )
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up", duration_minutes=60
        )

        slots = get_open_slots(
            provider, appointment_type, date(2026, 8, 17), date(2026, 8, 17), now=_utc(2026, 1, 1)
        )

        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0].start, _utc(2026, 8, 17, 14, 0))  # 09:00 CDT == 14:00 UTC
        self.assertEqual(slots[0].end, _utc(2026, 8, 17, 15, 0))
