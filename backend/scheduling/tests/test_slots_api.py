from bookings.models import Booking
from scheduling.models import AppointmentType, Availability, BlockedTime

from .helpers import SchedulingAPITestCase


class SlotsEndpointTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.patient = self.create_patient()

    def _query(self, **overrides):
        params = {
            "provider_id": self.provider.id,
            "appointment_type_id": self.appointment_type.id,
            "date_from": "2026-08-17",
            "date_to": "2026-08-21",
            **overrides,
        }
        query_string = "&".join(f"{key}={value}" for key, value in params.items())
        return self.client.get(f"/scheduling/slots?{query_string}")

    def test_any_authenticated_user_can_read_a_providers_slots(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["bookable"])
        self.assertEqual(len(body["slots"]), 8)
        self.assertEqual(body["slots"][0]["start"], "2026-08-17T09:00:00Z")
        self.assertEqual(body["slots"][0]["end"], "2026-08-17T10:00:00Z")

    def test_unauthenticated_request_is_rejected(self):
        response = self._query()

        self.assertEqual(response.status_code, 401)

    def test_flags_not_bookable_when_provider_has_no_working_hours(self):
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["bookable"])
        self.assertEqual(body["slots"], [])
        self.assertIn("working hours", body["reason"])

    def test_unknown_provider_id_returns_404(self):
        self.login_as(self.patient)

        response = self._query(provider_id=999999)

        self.assertEqual(response.status_code, 404)

    def test_provider_id_pointing_at_a_patient_returns_404(self):
        self.login_as(self.patient)

        response = self._query(provider_id=self.patient.id)

        self.assertEqual(response.status_code, 404)

    def test_appointment_type_not_belonging_to_provider_returns_404(self):
        other_provider = self.create_provider(email="other@example.com")
        other_type = AppointmentType.objects.create(provider=other_provider, name="Physical")
        self.login_as(self.patient)

        response = self._query(appointment_type_id=other_type.id)

        self.assertEqual(response.status_code, 404)

    def test_missing_query_params_returns_400(self):
        self.login_as(self.patient)

        response = self.client.get("/scheduling/slots")

        self.assertEqual(response.status_code, 400)

    def test_date_to_before_date_from_returns_400(self):
        self.login_as(self.patient)

        response = self._query(date_from="2026-08-21", date_to="2026-08-17")

        self.assertEqual(response.status_code, 400)

    def test_date_range_exceeding_the_cap_returns_400(self):
        self.login_as(self.patient)

        response = self._query(date_from="2026-01-01", date_to="2026-12-31")

        self.assertEqual(response.status_code, 400)

    def test_a_60_minute_type_and_a_30_minute_type_each_produce_their_own_grid(self):
        # Two saved types on the same provider/day: the 60-minute one
        # yields the hourly grid, the 30-minute one twice as many slots on
        # :00/:30 boundaries -- through the real API, against real rows,
        # now that the DB admits both durations.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        half_hour_type = AppointmentType.objects.create(
            provider=self.provider, name="Quick Check", duration_minutes=30
        )
        self.login_as(self.patient)

        hourly_response = self._query(date_to="2026-08-17")
        half_hour_response = self._query(
            appointment_type_id=half_hour_type.id, date_to="2026-08-17"
        )

        hourly = hourly_response.json()["slots"]
        self.assertEqual(len(hourly), 8)
        self.assertEqual(hourly[0]["start"], "2026-08-17T09:00:00Z")
        self.assertEqual(hourly[0]["end"], "2026-08-17T10:00:00Z")

        half_hour = half_hour_response.json()["slots"]
        self.assertEqual(len(half_hour), 16)
        self.assertEqual(half_hour[0]["start"], "2026-08-17T09:00:00Z")
        self.assertEqual(half_hour[0]["end"], "2026-08-17T09:30:00Z")
        self.assertEqual(half_hour[1]["start"], "2026-08-17T09:30:00Z")
        self.assertEqual(half_hour[1]["end"], "2026-08-17T10:00:00Z")
        # Every start sits on a :00 or :30 boundary.
        self.assertTrue(
            all(slot["start"].endswith((":00:00Z", ":30:00Z")) for slot in half_hour)
        )


class BlockedTimeExclusionTests(SchedulingAPITestCase):
    """TICKET-05, exercised through the real `GET /scheduling/slots` seam
    (not just `get_open_slots` directly) -- a provider blocking a range
    makes exactly that range's slots disappear, and a block outside working
    hours neither errors nor duplicates anything."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.patient = self.create_patient()

    def _query(self, **overrides):
        params = {
            "provider_id": self.provider.id,
            "appointment_type_id": self.appointment_type.id,
            "date_from": "2026-08-17",
            "date_to": "2026-08-17",
            **overrides,
        }
        query_string = "&".join(f"{key}={value}" for key, value in params.items())
        return self.client.get(f"/scheduling/slots?{query_string}")

    def test_blocking_a_range_removes_exactly_those_slots(self):
        # Monday 2026-08-17, 09:00-17:00 -> 8 one-hour slots without a
        # block. Block 12:00-14:00 -> the 12:00 and 13:00 slots vanish,
        # everything else survives untouched.
        BlockedTime.objects.create(
            provider=self.provider,
            start="2026-08-17T12:00:00Z",
            end="2026-08-17T14:00:00Z",
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(response.status_code, 200)
        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertEqual(len(starts), 6)
        self.assertNotIn("2026-08-17T12:00:00Z", starts)
        self.assertNotIn("2026-08-17T13:00:00Z", starts)
        self.assertIn("2026-08-17T09:00:00Z", starts)
        self.assertIn("2026-08-17T14:00:00Z", starts)

    def test_a_block_outside_working_hours_does_not_error_or_duplicate_slots(self):
        # Blocked 20:00-22:00 -- entirely outside the 09:00-17:00 working
        # window, so it should have no effect at all.
        BlockedTime.objects.create(
            provider=self.provider,
            start="2026-08-17T20:00:00Z",
            end="2026-08-17T22:00:00Z",
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["slots"]), 8)
        self.assertEqual(len({slot["start"] for slot in body["slots"]}), 8)

    def test_a_block_on_another_providers_calendar_does_not_affect_this_query(self):
        other_provider = self.create_provider(email="other@example.com", timezone="UTC")
        BlockedTime.objects.create(
            provider=other_provider,
            start="2026-08-17T12:00:00Z",
            end="2026-08-17T14:00:00Z",
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(len(response.json()["slots"]), 8)

    def test_a_block_far_outside_the_query_range_does_not_affect_it(self):
        BlockedTime.objects.create(
            provider=self.provider,
            start="2026-09-01T00:00:00Z",
            end="2026-09-02T00:00:00Z",
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(len(response.json()["slots"]), 8)


class BookingExclusionTests(SchedulingAPITestCase):
    """TICKET-07 point 7: a real `Booking` row is folded into
    `busy_intervals` exactly like a `BlockedTime` row already is (see
    `BlockedTimeExclusionTests` above) -- a requested/confirmed booking
    removes its slot from the open list; a cancelled one never should."""

    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.patient = self.create_patient()

    def _query(self, **overrides):
        params = {
            "provider_id": self.provider.id,
            "appointment_type_id": self.appointment_type.id,
            "date_from": "2026-08-17",
            "date_to": "2026-08-17",
            **overrides,
        }
        query_string = "&".join(f"{key}={value}" for key, value in params.items())
        return self.client.get(f"/scheduling/slots?{query_string}")

    def _booking(self, status):
        return Booking.objects.create(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time="2026-08-17T12:00:00Z",
            end_time="2026-08-17T13:00:00Z",
            status=status,
        )

    def test_a_confirmed_booking_removes_exactly_its_own_slot(self):
        self._booking(Booking.Status.CONFIRMED)
        self.login_as(self.patient)

        response = self._query()

        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertEqual(len(starts), 7)
        self.assertNotIn("2026-08-17T12:00:00Z", starts)

    def test_a_requested_booking_also_removes_its_slot(self):
        self._booking(Booking.Status.REQUESTED)
        self.login_as(self.patient)

        response = self._query()

        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertNotIn("2026-08-17T12:00:00Z", starts)

    def test_a_cancelled_booking_does_not_remove_its_slot(self):
        self._booking(Booking.Status.CANCELLED)
        self.login_as(self.patient)

        response = self._query()

        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertEqual(len(starts), 8)
        self.assertIn("2026-08-17T12:00:00Z", starts)

    def test_a_patients_booking_elsewhere_hides_that_hour_from_this_provider(self):
        other_provider = self.create_provider(email="other@example.com", timezone="UTC")
        Booking.objects.create(
            provider=other_provider,
            patient=self.patient,
            appointment_type=AppointmentType.objects.create(
                provider=other_provider, name="Follow-up", duration_minutes=60
            ),
            start_time="2026-08-17T12:00:00Z",
            end_time="2026-08-17T13:00:00Z",
            status=Booking.Status.CONFIRMED,
        )
        self.login_as(self.patient)

        response = self._query()

        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertEqual(len(starts), 7)
        self.assertNotIn("2026-08-17T12:00:00Z", starts)

    def test_a_patients_60_minute_booking_elsewhere_hides_an_overlapping_30_minute_slot(self):
        # Mixed durations on the patient axis: this patient holds a
        # 60-minute 12:00-13:00 booking with another provider, so this
        # provider's 30-minute type must offer neither 12:00 nor 12:30 --
        # the busy-interval fold is overlap-based, not start-time-based.
        other_provider = self.create_provider(email="other@example.com", timezone="UTC")
        Booking.objects.create(
            provider=other_provider,
            patient=self.patient,
            appointment_type=AppointmentType.objects.create(
                provider=other_provider, name="Follow-up", duration_minutes=60
            ),
            start_time="2026-08-17T12:00:00Z",
            end_time="2026-08-17T13:00:00Z",
            status=Booking.Status.CONFIRMED,
        )
        half_hour_type = AppointmentType.objects.create(
            provider=self.provider, name="Quick check", duration_minutes=30
        )
        self.login_as(self.patient)

        response = self._query(appointment_type_id=half_hour_type.id)

        starts = [slot["start"] for slot in response.json()["slots"]]
        self.assertNotIn("2026-08-17T12:00:00Z", starts)
        self.assertNotIn("2026-08-17T12:30:00Z", starts)
        self.assertIn("2026-08-17T11:30:00Z", starts)
        self.assertIn("2026-08-17T13:00:00Z", starts)

    def test_another_patients_booking_elsewhere_does_not_hide_this_providers_hour(self):
        other_patient = self.create_patient(email="other-patient@example.com")
        other_provider = self.create_provider(email="other@example.com", timezone="UTC")
        Booking.objects.create(
            provider=other_provider,
            patient=other_patient,
            appointment_type=AppointmentType.objects.create(
                provider=other_provider, name="Follow-up", duration_minutes=60
            ),
            start_time="2026-08-17T12:00:00Z",
            end_time="2026-08-17T13:00:00Z",
            status=Booking.Status.CONFIRMED,
        )
        self.login_as(self.patient)

        response = self._query()

        self.assertEqual(len(response.json()["slots"]), 8)
