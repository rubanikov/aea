"""HTTP-seam tests for `GET /bookings` (TICKET-08's provider calendar list
feed) -- scoping (a provider sees only their own bookings, an admin sees
every provider's or one provider's), date-range filtering, and the response
shape. Patient-vs-provider scoping decision: this endpoint is
provider-and-admin only (see `bookings.views.BookingListCreateView.get`'s
docstring) -- a patient's own appointment list is TICKET-09's endpoint, not
this one, so a patient here gets `403`, not a scoped-to-self result.
"""

from datetime import datetime
from datetime import timezone as dt_timezone

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class BookingListTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.other_provider, self.other_appointment_type = self.setup_bookable_provider(
            email="other-provider@example.com"
        )
        self.patient = self.create_patient()

        self.own_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
        )
        self.other_providers_booking = self.make_booking(
            provider=self.other_provider,
            patient=self.patient,
            appointment_type=self.other_appointment_type,
            start_time=_utc(2026, 8, 17, 10, 0),
        )

    def test_provider_sees_only_their_own_bookings(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings")

        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.own_booking.id})

    def test_list_response_shape(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings")

        row = response.json()[0]
        self.assertEqual(
            set(row.keys()),
            {
                "id",
                "patient_id",
                "patient_name",
                "appointment_type_name",
                "start_time",
                "end_time",
                "status",
            },
        )
        self.assertEqual(row["patient_id"], self.patient.id)
        self.assertEqual(row["patient_name"], self.patient.name)
        self.assertEqual(row["appointment_type_name"], self.appointment_type.name)
        self.assertEqual(row["status"], "confirmed")

    def test_a_provider_supplied_provider_id_is_ignored_and_stays_scoped_to_self(self):
        self.login_as(self.provider)

        response = self.client.get(f"/bookings?provider_id={self.other_provider.id}")

        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.own_booking.id})

    def test_date_range_filters_to_bookings_starting_within_it(self):
        outside_range = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 24, 9, 0),
        )
        self.login_as(self.provider)

        response = self.client.get("/bookings?date_from=2026-08-17&date_to=2026-08-17")

        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.own_booking.id})
        self.assertNotIn(outside_range.id, ids)

    def test_date_from_without_date_to_returns_400(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings?date_from=2026-08-17")

        self.assertEqual(response.status_code, 400)

    def test_date_to_before_date_from_returns_400(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings?date_from=2026-08-17&date_to=2026-08-10")

        self.assertEqual(response.status_code, 400)

    def test_no_bookings_in_range_returns_an_empty_list_cleanly(self):
        self.login_as(self.provider)

        response = self.client.get("/bookings?date_from=2030-01-01&date_to=2030-01-07")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_results_are_ordered_chronologically(self):
        earlier = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 10, 9, 0),
        )
        self.login_as(self.provider)

        response = self.client.get("/bookings")

        ids = [row["id"] for row in response.json()]
        self.assertEqual(ids.index(earlier.id), 0)

    def test_admin_sees_every_providers_bookings_by_default(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self.client.get("/bookings")

        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.own_booking.id, self.other_providers_booking.id})

    def test_admin_can_scope_to_one_provider_via_provider_id(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self.client.get(f"/bookings?provider_id={self.other_provider.id}")

        ids = {row["id"] for row in response.json()}
        self.assertEqual(ids, {self.other_providers_booking.id})

    def test_patient_cannot_list_bookings_from_this_endpoint(self):
        self.login_as(self.patient)

        response = self.client.get("/bookings")

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/bookings")

        self.assertEqual(response.status_code, 401)
