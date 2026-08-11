"""HTTP-seam tests for `PATCH /bookings/<id>/status` (TICKET-08) --
permissions, status codes, and response/audit shape. `test_transitions.py`
covers the underlying guard logic (every allowed/rejected transition, the
no_show timing rule) directly against `transition()`; this file only needs
to prove the view wires that logic up correctly, not re-derive every case.
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
FUTURE_START = _utc(2099, 1, 5, 9, 0)


class BookingStatusUpdateTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def _patch_status(self, booking_id, new_status):
        return self.patch_json(f"/bookings/{booking_id}/status", {"status": new_status})

    def test_provider_can_cancel_their_own_booking(self):
        self.login_as(self.provider)

        response = self._patch_status(self.booking.id, "cancelled")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], self.booking.id)
        self.assertEqual(body["status"], "cancelled")
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)

    def test_provider_cancelling_inside_the_notice_window_is_rejected(self):
        # TICKET-09: the 24h minimum-notice rule lives inside `transition()`
        # itself, so it applies through this provider-facing endpoint too,
        # not just TICKET-09's own patient-facing `/cancel` endpoint.
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )
        self.login_as(self.provider)

        response = self._patch_status(soon_booking.id, "cancelled")

        self.assertEqual(response.status_code, 400)
        self.assertIn("24 hours", response.json()["detail"])
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CONFIRMED)

    def test_provider_can_mark_their_own_booking_completed(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
        )
        self.login_as(self.provider)

        response = self._patch_status(past_booking.id, "completed")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")

    def test_provider_can_mark_no_show_once_start_time_has_passed(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
        )
        self.login_as(self.provider)

        response = self._patch_status(past_booking.id, "no_show")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "no_show")

    def test_no_show_before_start_time_returns_a_distinct_400(self):
        self.login_as(self.provider)

        response = self._patch_status(self.booking.id, "no_show")

        self.assertEqual(response.status_code, 400)
        self.assertIn("start time", response.json()["detail"])
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_an_already_cancelled_booking_cannot_become_completed(self):
        self.login_as(self.provider)
        self._patch_status(self.booking.id, "cancelled")

        response = self._patch_status(self.booking.id, "completed")

        self.assertEqual(response.status_code, 400)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)

    def test_confirm_and_decline_are_not_accepted_values(self):
        # architecture.md §4's auto-accept rule: there is no confirm/decline
        # action, every booking a provider sees already arrived confirmed.
        self.login_as(self.provider)

        for bogus_status in ("confirmed", "requested", "declined", "accepted"):
            response = self._patch_status(self.booking.id, bogus_status)
            self.assertEqual(response.status_code, 400, bogus_status)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_valid_transition_writes_exactly_one_audit_entry(self):
        self.login_as(self.provider)

        self._patch_status(self.booking.id, "cancelled")

        entries = AuditLog.objects.filter(target_type="booking", target_id=str(self.booking.id))
        self.assertEqual(entries.count(), 1)
        entry = entries.get()
        self.assertEqual(entry.action, "status:confirmed->cancelled")
        self.assertEqual(entry.actor_id, self.provider.id)

    def test_invalid_transition_writes_no_audit_entry(self):
        self.login_as(self.provider)
        self._patch_status(self.booking.id, "cancelled")
        AuditLog.objects.all().delete()

        self._patch_status(self.booking.id, "completed")

        self.assertEqual(AuditLog.objects.count(), 0)

    def test_unauthenticated_request_is_rejected(self):
        response = self._patch_status(self.booking.id, "cancelled")

        self.assertEqual(response.status_code, 401)

    def test_patient_cannot_update_booking_status(self):
        self.login_as(self.patient)

        response = self._patch_status(self.booking.id, "cancelled")

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_a_different_providers_booking_is_forbidden(self):
        other_provider = self.create_provider(email="other-provider@example.com")
        self.login_as(other_provider)

        response = self._patch_status(self.booking.id, "cancelled")

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_admin_can_update_any_booking_status_and_the_bypass_is_audited(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self._patch_status(self.booking.id, "cancelled")

        self.assertEqual(response.status_code, 200)
        bypass_entry = AuditLog.objects.get(action="admin_bypass:patch:booking")
        self.assertEqual(bypass_entry.actor_id, admin.id)
        self.assertEqual(bypass_entry.target_type, "booking")
        self.assertEqual(bypass_entry.target_id, str(self.booking.id))
        transition_entry = AuditLog.objects.get(action="status:confirmed->cancelled")
        self.assertEqual(transition_entry.actor_id, admin.id)

    def test_unknown_booking_id_returns_404(self):
        self.login_as(self.provider)

        response = self._patch_status(999999, "cancelled")

        self.assertEqual(response.status_code, 404)

    def test_missing_status_in_body_returns_400(self):
        self.login_as(self.provider)

        response = self.patch_json(f"/bookings/{self.booking.id}/status", {})

        self.assertEqual(response.status_code, 400)
