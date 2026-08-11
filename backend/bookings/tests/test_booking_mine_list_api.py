"""HTTP-seam tests for `GET /bookings/mine` -- the patient-scoped
appointment list `GET /bookings`'s own docstring forward-references
(TICKET-08 left it out; TICKET-09's frontend "My Appointments" UI was
built against this exact assumed contract -- see
`frontend/lib/bookings/types.ts`'s `PatientBooking`). Scoping (a patient
sees only their own bookings), ordering, the empty-list case, the
response shape, and the non-patient/unauthenticated rejections.
"""

from datetime import datetime
from datetime import timezone as dt_timezone

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class BookingMineListTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.other_patient = self.create_patient(email="other-patient@example.com")

        self.own_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
        )
        self.other_patients_booking = self.make_booking(
            provider=self.provider,
            patient=self.other_patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 10, 0),
        )

    def test_patient_sees_only_their_own_bookings(self):
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.own_booking.id})
        self.assertNotIn(self.other_patients_booking.id, ids)

    def test_response_shape_matches_patient_booking_field_for_field(self):
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        row = response.json()[0]
        self.assertEqual(
            set(row.keys()),
            {
                "id",
                "provider_id",
                "provider_name",
                "appointment_type_name",
                "start_time",
                "end_time",
                "status",
            },
        )
        self.assertEqual(row["id"], self.own_booking.id)
        self.assertEqual(row["provider_id"], self.provider.id)
        self.assertEqual(row["provider_name"], self.provider.name)
        self.assertEqual(row["appointment_type_name"], self.appointment_type.name)
        self.assertEqual(row["start_time"], "2026-08-17T09:00:00Z")
        self.assertEqual(row["end_time"], "2026-08-17T10:00:00Z")
        self.assertEqual(row["status"], "confirmed")

    def test_results_are_ordered_by_start_time(self):
        earlier = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 10, 9, 0),
        )
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        ids = [row["id"] for row in response.json()]
        self.assertEqual(ids, [earlier.id, self.own_booking.id])

    def test_no_date_range_filter_returns_every_status_including_cancelled(self):
        cancelled = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2020, 1, 1, 9, 0),
            status="cancelled",
        )
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        ids = {row["id"] for row in response.json()}
        self.assertIn(cancelled.id, ids)

    def test_patient_with_no_bookings_gets_an_empty_list(self):
        lonely_patient = self.create_patient(email="lonely@example.com")
        self.login_as(lonely_patient)

        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_provider_caller_gets_403(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 403)

    def test_admin_caller_gets_403(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 401)
