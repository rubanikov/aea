"""HTTP-seam tests for `GET /bookings/mine` -- the patient-scoped
appointment list `GET /bookings`'s own docstring forward-references
(TICKET-08 left it out; TICKET-09's frontend "My Appointments" UI was
built against this exact assumed contract -- see
`frontend/lib/bookings/types.ts`'s `PatientBooking`). Scoping (a patient
sees only their own bookings), ordering, the empty-list case, the
response shape, and the non-patient/unauthenticated rejections.

`reminder_sent` (TICKET-12's addendum) has its own dedicated test class
below, `PatientBookingListReminderSentTests` -- true/false per booking and
the no-N+1 claim `PatientBookingReminderAnnotatedListSerializer`'s
docstring makes, kept separate from the scoping/ordering/shape tests above
so a query-count regression is unambiguous about which behavior broke.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.db import connection
from django.test.utils import CaptureQueriesContext

from reminders.models import ReminderLog

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
                "appointment_type_id",
                "appointment_type_name",
                "start_time",
                "end_time",
                "status",
                "reminder_sent",
            },
        )
        self.assertEqual(row["id"], self.own_booking.id)
        self.assertEqual(row["provider_id"], self.provider.id)
        self.assertEqual(row["provider_name"], self.provider.name)
        self.assertEqual(row["appointment_type_id"], self.appointment_type.id)
        self.assertEqual(row["appointment_type_name"], self.appointment_type.name)
        self.assertEqual(row["start_time"], "2026-08-17T09:00:00Z")
        self.assertEqual(row["end_time"], "2026-08-17T10:00:00Z")
        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["reminder_sent"], False)

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


class PatientBookingListReminderSentTests(BookingsAPITestCase):
    """`reminder_sent` on `GET /bookings/mine` (TICKET-12's addendum) --
    true only once a `ReminderLog(interval="24h")` row exists for that
    booking, and the annotation approach
    (`PatientBookingReminderAnnotatedListSerializer`) does not add a query
    per row.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def test_booking_with_a_24h_reminder_log_shows_reminder_sent_true(self):
        booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
        )
        ReminderLog.objects.create(booking=booking, interval=ReminderLog.INTERVAL_24H)
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        row = next(row for row in response.json() if row["id"] == booking.id)
        self.assertTrue(row["reminder_sent"])

    def test_booking_with_no_reminder_log_shows_reminder_sent_false(self):
        booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
        )
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        row = next(row for row in response.json() if row["id"] == booking.id)
        self.assertFalse(row["reminder_sent"])

    def test_reminder_sent_does_not_add_a_query_per_row(self):
        """Same claim `PatientBookingReminderAnnotatedListSerializer`'s own
        docstring makes: the `EXISTS` annotation is one subquery folded into
        the list query, not one query per row. Proven by asserting the
        query count for a 1-booking list matches a 5-booking list, rather
        than an exact count -- an exact-count assertion would also bake in
        incidental per-request auth/session query counts that have nothing
        to do with this claim.
        """

        def _seed(patient, count, *, start_day):
            # Distinct days between the two patients' bookings -- they share
            # `self.provider`, and `Booking.Meta`'s partial `UniqueConstraint`
            # is keyed on `(provider, start_time)`, so overlapping start
            # times across the two sets would collide.
            for i in range(count):
                booking = self.make_booking(
                    provider=self.provider,
                    patient=patient,
                    appointment_type=self.appointment_type,
                    start_time=_utc(2026, 8, start_day, 9, 0) + timedelta(hours=i),
                )
                if i % 2 == 0:
                    ReminderLog.objects.create(booking=booking, interval=ReminderLog.INTERVAL_24H)

        one_booking_patient = self.create_patient(email="one-booking@example.com")
        five_booking_patient = self.create_patient(email="five-bookings@example.com")
        _seed(one_booking_patient, 1, start_day=17)
        _seed(five_booking_patient, 5, start_day=18)

        self.login_as(one_booking_patient)
        with CaptureQueriesContext(connection) as one_queries:
            one_response = self.client.get("/bookings/mine")
        self.assertEqual(len(one_response.json()), 1)

        self.login_as(five_booking_patient)
        with CaptureQueriesContext(connection) as five_queries:
            five_response = self.client.get("/bookings/mine")
        self.assertEqual(len(five_response.json()), 5)

        self.assertEqual(len(one_queries.captured_queries), len(five_queries.captured_queries))
