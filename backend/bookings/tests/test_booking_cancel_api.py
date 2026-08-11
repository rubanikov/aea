"""HTTP-seam tests for `PATCH /bookings/<id>/cancel` (TICKET-09) --
permissions (the *patient*-ownership axis, distinct from
`test_booking_status_api.py`'s provider axis), the minimum-notice rule
surfacing as a clean 400, and the "cancelling frees the slot atomically"
acceptance criterion, exercised end-to-end through the real `GET
/scheduling/slots` endpoint (not just a DB-row check). The notice-rule
guard logic itself is covered directly against `transition()` in
`test_transitions.py`'s `CancellationNoticeRuleTests`; this file only
needs to prove this view wires that logic up correctly, same division of
labor as `test_booking_status_api.py`.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

from audit.models import AuditLog
from bookings.models import Booking

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


PAST_START = _utc(2020, 1, 6, 9, 0)
FAR_FUTURE_START = _utc(2099, 1, 5, 9, 0)


class BookingCancelTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FAR_FUTURE_START,
        )

    def _cancel(self, booking_id):
        return self.patch_json(f"/bookings/{booking_id}/cancel", {})

    def test_patient_can_cancel_their_own_upcoming_booking(self):
        self.login_as(self.patient)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], self.booking.id)
        self.assertEqual(body["status"], "cancelled")
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)

    def test_cancel_writes_exactly_one_audit_entry(self):
        self.login_as(self.patient)

        self._cancel(self.booking.id)

        entries = AuditLog.objects.filter(target_type="booking", target_id=str(self.booking.id))
        self.assertEqual(entries.count(), 1)
        entry = entries.get()
        self.assertEqual(entry.action, "status:confirmed->cancelled")
        self.assertEqual(entry.actor_id, self.patient.id)

    def test_cancel_attempt_inside_the_notice_window_is_rejected_with_a_specific_error(self):
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )
        self.login_as(self.patient)

        response = self._cancel(soon_booking.id)

        self.assertEqual(response.status_code, 400)
        self.assertIn("24 hours", response.json()["detail"])
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_unauthenticated_request_is_rejected(self):
        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 401)

    def test_patient_cannot_cancel_someone_elses_booking(self):
        other_patient = self.create_patient(email="other-patient@example.com")
        self.login_as(other_patient)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_a_provider_cannot_use_this_endpoint_for_their_own_booking(self):
        # The provider-ownership axis is `PATCH /bookings/<id>/status`, not
        # this endpoint -- `IsOwnerOrAdmin` here checks `booking.patient`,
        # and the provider is neither the patient nor an admin.
        self.login_as(self.provider)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_admin_can_cancel_any_booking_and_the_bypass_is_audited(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200)
        bypass_entry = AuditLog.objects.get(action="admin_bypass:patch:booking")
        self.assertEqual(bypass_entry.actor_id, admin.id)
        self.assertEqual(bypass_entry.target_type, "booking")
        self.assertEqual(bypass_entry.target_id, str(self.booking.id))
        transition_entry = AuditLog.objects.get(action="status:confirmed->cancelled")
        self.assertEqual(transition_entry.actor_id, admin.id)

    def test_an_already_cancelled_booking_cannot_be_cancelled_again(self):
        self.login_as(self.patient)
        self._cancel(self.booking.id)
        AuditLog.objects.all().delete()

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_a_completed_booking_cannot_be_cancelled(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
            status=Booking.Status.COMPLETED,
        )
        self.login_as(self.patient)

        response = self._cancel(past_booking.id)

        self.assertEqual(response.status_code, 400)
        past_booking.refresh_from_db()
        self.assertEqual(past_booking.status, Booking.Status.COMPLETED)

    def test_a_no_show_booking_cannot_be_cancelled(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
            status=Booking.Status.NO_SHOW,
        )
        self.login_as(self.patient)

        response = self._cancel(past_booking.id)

        self.assertEqual(response.status_code, 400)

    def test_unknown_booking_id_returns_404(self):
        self.login_as(self.patient)

        response = self._cancel(999999)

        self.assertEqual(response.status_code, 404)


class CancellationFreesTheSlotImmediatelyTests(BookingsAPITestCase):
    """TICKET-09's atomicity acceptance criterion, exercised end-to-end:
    book a slot through the real `POST /bookings` flow, cancel it through
    this ticket's endpoint, then immediately re-query the real `GET
    /scheduling/slots` for that exact window and confirm it's open again
    -- not just that the DB row's `status` column changed underneath it.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider(timezone="UTC")
        self.patient = self.create_patient()

    def _slots(self, date):
        return self.client.get(
            "/scheduling/slots"
            f"?provider_id={self.provider.id}"
            f"&appointment_type_id={self.appointment_type.id}"
            f"&date_from={date}&date_to={date}"
        )

    def test_cancelling_a_booking_immediately_reopens_its_exact_slot(self):
        self.login_as(self.patient)
        booking_date = "2026-08-17"  # a Monday -- setup_bookable_provider's day_of_week=0

        create_response = self.post_json(
            "/bookings",
            {
                "provider_id": self.provider.id,
                "appointment_type_id": self.appointment_type.id,
                "start_time": f"{booking_date}T09:00:00Z",
            },
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        booking_id = create_response.json()["id"]

        before_cancel = self._slots(booking_date)
        starts_before = [slot["start"] for slot in before_cancel.json()["slots"]]
        self.assertNotIn(f"{booking_date}T09:00:00Z", starts_before)

        cancel_response = self.patch_json(f"/bookings/{booking_id}/cancel", {})
        self.assertEqual(cancel_response.status_code, 200, cancel_response.content)

        after_cancel = self._slots(booking_date)
        starts_after = [slot["start"] for slot in after_cancel.json()["slots"]]
        self.assertIn(f"{booking_date}T09:00:00Z", starts_after)
