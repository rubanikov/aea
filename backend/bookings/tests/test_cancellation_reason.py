"""Provider-cancel-requires-a-written-reason (doctor-cancel-reason-notify
ticket 01) -- `Booking.cancellation_reason` end to end through `PATCH
/bookings/<id>/status`, plus the regression guards the field's audit-log
convention demands:

- the reason is required (non-blank, <= 500 chars) when, and only when,
  the target status is `cancelled` -- sending one alongside `completed`/
  `no_show` is a 400, not silently dropped;
- a rejected transition (bad transition, notice window, permissions)
  leaves `cancellation_reason` untouched;
- the audit entry for the transition records who initiated it by *role*
  but never the reason text itself (architecture.md §6, "no PHI in logs");
- every *other* cancellation path (patient self-cancel, reschedule's
  implicit cancel, account deletion's bulk cancel) still leaves
  `cancellation_reason == ""` -- the reason is a provider-status-endpoint
  concept only in this ticket.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.tests.helpers import TEST_PASSWORD
from audit.models import AuditLog
from bookings.models import Booking

from .helpers import BookingsAPITestCase

User = get_user_model()


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Same anchors as `test_booking_status_api.py` -- a far-future Monday clears
# the 24h notice window regardless of the real wall-clock date.
FUTURE_START = _utc(2099, 1, 5, 9, 0)
PAST_START = _utc(2020, 1, 6, 9, 0)

# A Monday matching `setup_bookable_provider`'s `day_of_week=0` window, for
# the reschedule case below -- same constant `test_booking_reschedule_api.py`
# uses.
MONDAY = "2026-08-17"

REASON = "Called away to an emergency procedure; please rebook."


class ProviderCancelReasonTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def _patch_status(self, booking_id, body):
        return self.patch_json(f"/bookings/{booking_id}/status", body)

    def _assert_untouched(self, booking):
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(booking.cancellation_reason, "")

    def test_cancel_with_a_valid_reason_persists_and_returns_it(self):
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertEqual(response.json()["cancellation_reason"], REASON)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, REASON)

    def test_missing_reason_on_a_cancel_is_a_400_field_error(self):
        self.login_as(self.provider)

        response = self._patch_status(self.booking.id, {"status": "cancelled"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(self.booking)

    def test_blank_reason_on_a_cancel_is_a_400_field_error(self):
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": ""}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(self.booking)

    def test_whitespace_only_reason_on_a_cancel_is_a_400_field_error(self):
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": "   \t  "}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(self.booking)

    def test_reason_longer_than_500_chars_is_a_400_field_error(self):
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": "x" * 501}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(self.booking)

    def test_a_500_char_reason_is_accepted(self):
        self.login_as(self.provider)
        reason = "x" * 500

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": reason}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.cancellation_reason, reason)

    def test_surrounding_whitespace_is_stripped_before_storage(self):
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": f"  {REASON}  "}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.cancellation_reason, REASON)

    def test_reason_alongside_completed_is_rejected_not_silently_dropped(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
        )
        self.login_as(self.provider)

        response = self._patch_status(
            past_booking.id, {"status": "completed", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(past_booking)

    def test_reason_alongside_no_show_is_rejected_not_silently_dropped(self):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=PAST_START,
        )
        self.login_as(self.provider)

        response = self._patch_status(
            past_booking.id, {"status": "no_show", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("cancellation_reason", response.json())
        self._assert_untouched(past_booking)

    def test_notice_window_rejection_leaves_the_reason_untouched(self):
        # The 24h minimum-notice rule (TICKET-09) runs before any write --
        # a valid reason on a too-soon cancel must not be stored.
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )
        self.login_as(self.provider)

        response = self._patch_status(
            soon_booking.id, {"status": "cancelled", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("24 hours", response.json()["detail"])
        self._assert_untouched(soon_booking)

    def test_a_different_providers_booking_is_still_forbidden_with_a_reason(self):
        other_provider = self.create_provider(email="other-provider@example.com")
        self.login_as(other_provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 403)
        self._assert_untouched(self.booking)

    def test_cancel_response_now_carries_the_notification_key(self):
        # Ticket 01 asserted this key's *absence*; ticket 03 introduced it
        # (see `test_cancellation_notification.py` for its full contract).
        # This placeholder flips to guard the new contract's presence.
        self.login_as(self.provider)

        response = self._patch_status(
            self.booking.id, {"status": "cancelled", "cancellation_reason": REASON}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("notification", response.json())

    def test_audit_metadata_records_the_role_but_never_the_reason_text(self):
        # architecture.md §6's "no PHI in logs" convention: the audit entry
        # proves *that* and *by whom* the cancel happened; the free-text
        # reason lives only on the Booking row.
        self.login_as(self.provider)

        self._patch_status(self.booking.id, {"status": "cancelled", "cancellation_reason": REASON})

        entry = AuditLog.objects.get(action="status:confirmed->cancelled")
        self.assertEqual(entry.metadata["initiated_by_role"], "provider")
        self.assertNotIn(REASON, str(entry.metadata))
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.cancellation_reason, REASON)


class OtherCancelPathsLeaveReasonEmptyTests(BookingsAPITestCase):
    """The reason is a provider-status-endpoint concept in this ticket --
    every other path that ends in a `cancelled` booking must keep writing
    `cancellation_reason == ""`.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def test_patient_self_cancel_leaves_the_reason_empty(self):
        self.login_as(self.patient)

        response = self.patch_json(f"/bookings/{self.booking.id}/cancel", {})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["cancellation_reason"], "")
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, "")

    def test_reschedules_implicit_cancel_leaves_the_old_bookings_reason_empty(self):
        self.login_as(self.patient)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/reschedule", {"start_time": f"{MONDAY}T10:00:00Z"}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, "")

    def test_account_deletions_bulk_cancel_leaves_the_reason_empty(self):
        register_response = self.post_json(
            "/auth/register",
            {
                "email": "deletion.patient@example.com",
                "password": TEST_PASSWORD,
                "name": "Deletion Patient",
            },
        )
        assert register_response.status_code == 201, register_response.content
        deleting_patient = User.objects.get(email="deletion.patient@example.com")
        # A different slot from `self.booking`'s -- same provider, so the
        # same start_time would trip `unique_active_booking_per_provider_slot`.
        booking = self.make_booking(
            provider=self.provider,
            patient=deleting_patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START + timedelta(days=7),
        )

        deletion_response = self.post_json(
            "/profile/delete-account", {"password": TEST_PASSWORD}
        )

        self.assertEqual(deletion_response.status_code, 200, deletion_response.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)
        self.assertEqual(booking.cancellation_reason, "")


class ReasonInListEndpointsTests(BookingsAPITestCase):
    """`cancellation_reason` is part of every booking read shape --
    `BookingSerializer`, `BookingListSerializer` (`GET /bookings`) and
    `PatientBookingListSerializer` (`GET /bookings/mine`) -- and is `""`
    for every non-cancelled booking.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def test_provider_list_includes_the_reason(self):
        self.login_as(self.provider)
        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        response = self.client.get("/bookings")

        self.assertEqual(response.status_code, 200)
        row = response.json()[0]
        self.assertEqual(row["cancellation_reason"], REASON)

    def test_patient_mine_list_includes_the_reason_and_blank_for_active_bookings(self):
        self.login_as(self.provider)
        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )
        active_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START + timedelta(days=1),
        )
        self.login_as(self.patient)

        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.json()}
        self.assertEqual(rows[self.booking.id]["cancellation_reason"], REASON)
        self.assertEqual(rows[active_booking.id]["cancellation_reason"], "")
