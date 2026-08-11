from audit.models import AuditLog
from bookings.models import Booking
from scheduling.models import AppointmentType, BlockedTime

from .helpers import BookingsAPITestCase

# Monday -- matches the `day_of_week=0` availability window every fixture in
# this file configures (see `BookingsAPITestCase.setup_bookable_provider`).
MONDAY = "2026-08-17"


class BookingCreationHappyPathTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def test_booking_an_open_slot_creates_a_confirmed_appointment(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(
            set(body.keys()),
            {
                "id",
                "provider_id",
                "patient_id",
                "appointment_type_id",
                "start_time",
                "end_time",
                "status",
            },
        )
        self.assertEqual(body["provider_id"], self.provider.id)
        self.assertEqual(body["patient_id"], self.patient.id)
        self.assertEqual(body["appointment_type_id"], self.appointment_type.id)
        self.assertEqual(body["start_time"], f"{MONDAY}T09:00:00Z")
        self.assertEqual(body["end_time"], f"{MONDAY}T10:00:00Z")
        self.assertEqual(body["status"], "confirmed")

        booking = Booking.objects.get(pk=body["id"])
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)

    def test_booked_slot_immediately_disappears_from_the_open_slot_list(self):
        self.login_as(self.patient)
        query = (
            f"/scheduling/slots?provider_id={self.provider.id}"
            f"&appointment_type_id={self.appointment_type.id}"
            f"&date_from={MONDAY}&date_to={MONDAY}"
        )
        before = self.client.get(query)
        self.assertIn(
            {"start": f"{MONDAY}T09:00:00Z", "end": f"{MONDAY}T10:00:00Z"}, before.json()["slots"]
        )

        self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        after = self.client.get(query)
        self.assertNotIn(
            {"start": f"{MONDAY}T09:00:00Z", "end": f"{MONDAY}T10:00:00Z"}, after.json()["slots"]
        )

    def test_booking_writes_a_create_audit_entry_and_a_status_transition_entry(self):
        # TICKET-08: `create_booking`'s auto-confirm step now goes through
        # `bookings.transitions.transition`, the single write path for
        # every status change (architecture.md §4) -- so creating a
        # booking writes two distinct facts, not one: "this booking was
        # created" (`create:booking`) and "its auto-accept transition
        # happened" (`status:requested->confirmed`, actor=None, a
        # system-initiated transition per that function's own convention).
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        booking_id = response.json()["id"]
        entries = AuditLog.objects.filter(target_type="booking", target_id=str(booking_id))
        self.assertEqual(entries.count(), 2)

        create_entry = entries.get(action="create:booking")
        self.assertEqual(create_entry.actor_id, self.patient.id)
        self.assertEqual(create_entry.metadata["status"], "confirmed")

        transition_entry = entries.get(action="status:requested->confirmed")
        self.assertIsNone(transition_entry.actor_id)

    def test_client_cannot_override_the_server_computed_end_time(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/bookings",
            {
                "provider_id": self.provider.id,
                "appointment_type_id": self.appointment_type.id,
                "start_time": f"{MONDAY}T09:00:00Z",
                "end_time": f"{MONDAY}T23:00:00Z",  # ignored -- not a real field
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["end_time"], f"{MONDAY}T10:00:00Z")


class BookingCreationRejectionTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def test_unauthenticated_request_is_rejected(self):
        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 401)

    def test_provider_role_cannot_book_as_a_patient(self):
        self.login_as(self.provider)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Booking.objects.count(), 0)

    def test_admin_role_cannot_book_as_a_patient(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 403)

    def test_unknown_provider_id_returns_400(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/bookings",
            {
                "provider_id": 999999,
                "appointment_type_id": self.appointment_type.id,
                "start_time": f"{MONDAY}T09:00:00Z",
            },
        )

        self.assertEqual(response.status_code, 400)

    def test_provider_id_pointing_at_a_patient_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.patient,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 400)

    def test_unknown_appointment_type_id_returns_400(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/bookings",
            {
                "provider_id": self.provider.id,
                "appointment_type_id": 999999,
                "start_time": f"{MONDAY}T09:00:00Z",
            },
        )

        self.assertEqual(response.status_code, 400)

    def test_appointment_type_belonging_to_a_different_provider_returns_400(self):
        other_provider = self.create_provider(email="other@example.com")
        other_type = AppointmentType.objects.create(
            provider=other_provider, name="Physical", duration_minutes=45
        )
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider, appointment_type=other_type, start_time=f"{MONDAY}T09:00:00Z"
        )

        self.assertEqual(response.status_code, 400)

    def test_malformed_start_time_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time="not-a-datetime",
        )

        self.assertEqual(response.status_code, 400)

    def test_start_time_outside_working_hours_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T20:00:00Z",  # working hours are 09:00-17:00
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)

    def test_start_time_inside_a_blocked_range_returns_400(self):
        BlockedTime.objects.create(
            provider=self.provider, start=f"{MONDAY}T09:00:00Z", end=f"{MONDAY}T11:00:00Z"
        )
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)

    def test_start_time_in_the_past_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time="2020-01-06T09:00:00Z",  # a Monday, but long past
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)

    def test_start_time_misaligned_with_the_slot_grid_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:15:00Z",  # not a multiple of the 60-min grid
        )

        self.assertEqual(response.status_code, 400)


class BookingConflictTests(BookingsAPITestCase):
    """Sequential (non-concurrent) double-submit and existing-booking
    conflicts -- the genuinely simultaneous race is
    `bookings/tests/test_concurrency.py`."""

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.other_patient = self.create_patient(email="other-patient@example.com")

    def test_a_second_patient_booking_the_same_slot_gets_409(self):
        self.login_as(self.patient)
        first = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )
        self.assertEqual(first.status_code, 201)

        self.login_as(self.other_patient)
        second = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(second.status_code, 409)
        self.assertEqual(
            Booking.objects.filter(
                provider=self.provider, start_time=f"{MONDAY}T09:00:00Z"
            ).count(),
            1,
        )

    def test_retry_without_an_idempotency_key_creates_at_most_one_booking(self):
        # Double-click with no client-generated key at all -- falls back to
        # Layers 1+2 alone (this ticket's point 4).
        self.login_as(self.patient)

        first = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )
        second = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(Booking.objects.count(), 1)


class BookingIdempotencyTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def test_retrying_the_same_idempotency_key_returns_the_same_booking(self):
        self.login_as(self.patient)

        first = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
            idempotency_key="retry-key-1",
        )
        second = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
            idempotency_key="retry-key-1",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(Booking.objects.count(), 1)

    def test_different_idempotency_keys_for_different_slots_both_succeed(self):
        self.login_as(self.patient)

        first = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
            idempotency_key="key-a",
        )
        second = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T10:00:00Z",
            idempotency_key="key-b",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(Booking.objects.count(), 2)

    def test_oversized_idempotency_key_returns_400(self):
        self.login_as(self.patient)

        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{MONDAY}T09:00:00Z",
            idempotency_key="x" * 256,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)
