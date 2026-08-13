"""The patient-facing slot feed and the provider's own calendar must agree,
slot for slot, about the same working day.

Reported against `seed_demo`'s Dr. Ana Rossi (America/New_York, Mon-Fri
08:00-15:00): a patient was offered 8:00am and 1:00pm on a day her
calendar already had appointments at both, and the 2:00pm hour she had
marked as working was missing from the patient's grid entirely. (The bug
predates the fixed-60-minute-slot rule -- the fixtures here now use the
hourly grid that rule produces.)

The endpoint itself turned out to be right -- the two screens were plotting
the same UTC instants on two different clocks (fixed in
`frontend/components/booking/SlotBrowser.tsx`) -- so these tests exist to
keep it that way: every assertion below is expressed in the provider's own
wall clock, the one both screens now render, so a regression on either side
of the seam (a busy interval that stops being subtracted, a working-hours
edge that stops being generated, a timezone resolution that drifts) fails
here.
"""

from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from bookings.models import Booking
from scheduling.models import AppointmentType, Availability, BlockedTime

from .helpers import SchedulingAPITestCase

PROVIDER_ZONE = "America/New_York"
# A Wednesday well clear of any DST transition, and (matching the
# far-future dates the rest of this session's fixtures use, e.g.
# `FUTURE_START = _utc(2099, 1, 5, ...)` in bookings/tests) safely ahead of
# any run of this suite so `get_open_slots`'s "never offer the past" rule
# doesn't quietly empty the expected list.
WORKING_DAY = date(2099, 1, 7)


class SlotsMatchProviderCalendarTests(SchedulingAPITestCase):
    def setUp(self):
        self.zone = ZoneInfo(PROVIDER_ZONE)
        self.provider = self.create_provider(timezone=PROVIDER_ZONE)
        self.patient = self.create_patient()
        for day_of_week in range(5):  # Mon-Fri, as seeded.
            Availability.objects.create(
                provider=self.provider,
                day_of_week=day_of_week,
                start_time="08:00",
                end_time="15:00",
            )
        self.follow_up = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up"
        )

    def local(self, hour, minute=0):
        """The UTC instant of `hour:minute` on `WORKING_DAY` in the
        provider's own zone -- the same resolution `get_open_slots` does,
        and the clock both the provider calendar and the patient's slot grid
        display."""
        return datetime.combine(
            WORKING_DAY, time(hour, minute), tzinfo=self.zone
        ).astimezone(dt_timezone.utc)

    def open_local_times(self, appointment_type=None):
        """`GET /scheduling/slots` for `WORKING_DAY`, as the set of
        provider-local "HH:MM" start times it offers."""
        appointment_type = appointment_type or self.follow_up
        response = self.client.get(
            "/scheduling/slots"
            f"?provider_id={self.provider.id}"
            f"&appointment_type_id={appointment_type.id}"
            f"&date_from={WORKING_DAY.isoformat()}&date_to={WORKING_DAY.isoformat()}"
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["bookable"])
        return {
            datetime.fromisoformat(slot["start"]).astimezone(self.zone).strftime("%H:%M")
            for slot in body["slots"]
        }

    def test_a_booked_time_is_not_offered_and_its_neighbours_still_are(self):
        self.create_booking(
            provider=self.provider,
            appointment_type=self.follow_up,
            start_time=self.local(13, 0),
        )
        self.create_booking(
            provider=self.provider,
            appointment_type=self.follow_up,
            start_time=self.local(8, 0),
        )
        self.login_as(self.patient)

        open_times = self.open_local_times()

        self.assertNotIn("13:00", open_times)
        self.assertNotIn("08:00", open_times)
        # A 13:00-14:00 appointment blocks exactly its own hour, no more:
        # the slots either side stay bookable.
        self.assertIn("12:00", open_times)
        self.assertIn("14:00", open_times)
        self.assertIn("09:00", open_times)

    def test_every_configured_working_hour_is_offered_when_nothing_is_booked(self):
        self.login_as(self.patient)

        open_times = self.open_local_times()

        expected = {f"{hour:02d}:00" for hour in range(8, 15)}
        # 08:00 through 14:00 inclusive -- the whole configured day in
        # fixed one-hour slots, with nothing before it and nothing running
        # past 15:00.
        self.assertEqual(open_times, expected)

    def test_a_legacy_short_booking_still_blocks_the_hour_slot_it_sits_inside(self):
        """Bookings created before the fixed-60-minute rule keep their
        original shorter spans (the migration deliberately doesn't stretch
        them -- see scheduling/migrations/0003). A 13:00-13:15 legacy row
        must still make the 13:00 hour slot unbookable, without bleeding
        into its neighbours."""
        Booking.objects.create(
            provider=self.provider,
            patient=self.create_patient(email="legacy-patient@example.com"),
            appointment_type=self.follow_up,
            start_time=self.local(13, 0),
            end_time=self.local(13, 15),
            status=Booking.Status.CONFIRMED,
        )
        self.login_as(self.patient)

        open_times = self.open_local_times()

        self.assertNotIn("13:00", open_times)
        # 12:00-13:00 ends exactly where the appointment starts, so it is
        # genuinely still bookable -- blocked means overlapping, not adjacent.
        self.assertIn("12:00", open_times)
        self.assertIn("14:00", open_times)

    def test_blocked_time_and_bookings_are_subtracted_the_same_way(self):
        BlockedTime.objects.create(
            provider=self.provider,
            start=self.local(10, 0),
            end=self.local(11, 0),
            label="Admin",
        )
        self.login_as(self.patient)

        open_times = self.open_local_times()

        self.assertNotIn("10:00", open_times)
        self.assertIn("09:00", open_times)
        self.assertIn("11:00", open_times)

    def test_a_cancelled_appointment_frees_its_time_again(self):
        booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.follow_up,
            start_time=self.local(13, 0),
        )
        self.login_as(self.patient)
        self.assertNotIn("13:00", self.open_local_times())

        Booking.objects.filter(pk=booking.pk).update(status=Booking.Status.CANCELLED)

        self.assertIn("13:00", self.open_local_times())

    def test_the_provider_calendar_and_the_slot_feed_describe_the_same_day(self):
        """The two endpoints the two screens read, checked against each
        other: whatever `GET /bookings` shows the provider for a day must be
        exactly what `GET /scheduling/slots` withholds from the patient for
        that same day."""
        for hour in (8, 13):
            self.create_booking(
                provider=self.provider,
                appointment_type=self.follow_up,
                start_time=self.local(hour, 0),
            )

        self.login_as(self.provider)
        calendar = self.client.get(
            f"/bookings?date_from={WORKING_DAY.isoformat()}&date_to={WORKING_DAY.isoformat()}"
        )
        self.assertEqual(calendar.status_code, 200, calendar.content)
        busy_times = {
            datetime.fromisoformat(row["start_time"]).astimezone(self.zone).strftime("%H:%M")
            for row in calendar.json()
        }

        self.login_as(self.patient)
        open_times = self.open_local_times()

        self.assertEqual(busy_times, {"08:00", "13:00"})
        self.assertEqual(busy_times & open_times, set())
        # ...and nothing else went missing: every other hourly start in
        # the working day is still offered.
        all_starts = {f"{hour:02d}:00" for hour in range(8, 15)}
        self.assertEqual(open_times, all_starts - busy_times)


class ProviderCalendarDayBoundsTests(SchedulingAPITestCase):
    """`GET /bookings?date_from&date_to` -- the provider calendar's own feed.

    Its bounds are the calendar days of the provider whose calendar it is,
    resolved in that provider's timezone, exactly like `GET
    /scheduling/slots`. Interpreting them as UTC days instead silently drops
    appointments off the ends of the week for any provider whose working day
    doesn't sit inside a UTC one -- the same "two clocks over one set of
    rows" bug the patient-facing grid had, on the doctor's own screen.
    """

    def setUp(self):
        self.zone = ZoneInfo("Asia/Tokyo")  # UTC+9: an 08:00 start is 23:00Z *yesterday*.
        self.provider = self.create_provider(timezone="Asia/Tokyo")
        Availability.objects.create(
            provider=self.provider, day_of_week=2, start_time="08:00", end_time="17:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up"
        )
        self.morning = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=datetime.combine(
                WORKING_DAY, time(8, 0), tzinfo=self.zone
            ).astimezone(dt_timezone.utc),
        )

    def test_a_morning_appointment_appears_on_its_own_local_day(self):
        self.login_as(self.provider)

        response = self.client.get(
            f"/bookings?date_from={WORKING_DAY.isoformat()}&date_to={WORKING_DAY.isoformat()}"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row["id"] for row in response.json()], [self.morning.id])

    def test_it_does_not_leak_into_the_neighbouring_local_day(self):
        self.login_as(self.provider)
        previous_day = (WORKING_DAY - timedelta(days=1)).isoformat()

        response = self.client.get(
            f"/bookings?date_from={previous_day}&date_to={previous_day}"
        )

        self.assertEqual(response.json(), [])

    def create_admin(self, timezone="UTC"):
        admin = self.create_provider(email="admin@example.com", timezone=timezone)
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        return admin

    def test_an_admin_filtering_to_one_provider_gets_that_providers_local_day(self):
        self.login_as(self.create_admin())

        response = self.client.get(
            f"/bookings?provider_id={self.provider.id}"
            f"&date_from={WORKING_DAY.isoformat()}&date_to={WORKING_DAY.isoformat()}"
        )

        self.assertEqual([row["id"] for row in response.json()], [self.morning.id])

    def test_an_admin_listing_every_provider_falls_back_to_their_own_days(self):
        """No single calendar owner to key the days off, so the admin's own
        zone stands in -- here UTC, where this Tokyo-morning appointment
        belongs to the *previous* date."""
        self.login_as(self.create_admin(timezone="UTC"))
        previous_day = (WORKING_DAY - timedelta(days=1)).isoformat()

        response = self.client.get(
            f"/bookings?date_from={previous_day}&date_to={previous_day}"
        )

        self.assertEqual([row["id"] for row in response.json()], [self.morning.id])
