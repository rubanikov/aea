"""Cancellation with reason and patient notification -- acceptance tests
(doctor-cancel-reason-notify feature tickets 01-05).

This suite exercises the FULL USER STORY end-to-end through the real HTTP
surface, proving the cross-ticket composition is correct. The ticket builders
have already unit-tested each piece (email/SMS builders, validators,
serializers, response structure) -- this suite's job is to verify the pieces
work together as a coherent user-facing feature, from the moment a doctor
clicks "Cancel" through to the patient receiving notifications and viewing the
reason in their appointment list.

Each test covers one acceptance criterion from the approved story, exercising
the minimal set of systems needed to verify that criterion works end-to-end
without re-testing the builders' own unit test scope.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from audit.models import AuditLog
from bookings.models import Booking

from .helpers import BookingsAPITestCase

User = get_user_model()


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Far-future date that clears the 24h notice window regardless of when
# this test runs, matching other cancellation test files.
FUTURE_START = _utc(2099, 1, 5, 9, 0)

REASON = "Emergency procedure; please rebook at your convenience."
PHONE = "+1 (555) 123-4567"


class CancellationAcceptanceTests(BookingsAPITestCase):
    """End-to-end cancellation flows proving the feature works as intended."""

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider(
            timezone="America/New_York"
        )
        self.patient = self.create_patient(
            name="Alex Patient",
            email="patient@example.com",
            timezone="America/Chicago",
        )
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_1_and_2_doctor_cancel_sends_email_with_reason_and_correct_timezone(
        self, mock_send
    ):
        """Acceptance criteria 1 & 2: Doctor cancels with reason → email sent
        with cancellation statement, date/time in PATIENT's timezone, verbatim
        reason, and portal link — no names, no provider, no appointment type.
        """
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Criterion 1: cancel succeeds with valid reason
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertEqual(response.json()["cancellation_reason"], REASON)

        # Criterion 2: email was sent
        mock_send.assert_called_once()
        to, subject, body = mock_send.call_args[0]

        # Email goes to the patient
        self.assertEqual(to, self.patient.email)

        # Subject is the fixed line
        self.assertEqual(subject, "Your appointment was cancelled")

        # Body contains the cancellation statement (no "Hello" or names)
        self.assertIn("has been cancelled", body)

        # Date/time rendered in PATIENT's timezone (America/Chicago),
        # not provider's (America/New_York). FUTURE_START is 2099-01-05 09:00 UTC,
        # which is 2099-01-05 03:00 AM in America/Chicago (a Monday).
        self.assertIn(
            "Monday, January 5, 2099 at 3:00 AM (America/Chicago)", body
        )
        self.assertNotIn("America/New_York", body)

        # Verbatim reason, untruncated
        self.assertIn(REASON, body)

        # Portal link
        self.assertIn("https://app.example.com/patient/appointments", body)

        # No names, no provider, no appointment type
        self.assertNotIn(self.patient.name, body)
        self.assertNotIn("Alex", body)
        # Provider.name is empty by default in tests, but if it were set, it shouldn't appear
        if self.provider.name:
            self.assertNotIn(self.provider.name, body)
        # Same for appointment type
        if self.appointment_type.name:
            self.assertNotIn(self.appointment_type.name, body)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_3_doctor_cancel_sends_sms_when_phone_and_carrier_present(
        self, mock_send
    ):
        """Acceptance criterion 3: When patient has both phone and recognized
        carrier, SMS is sent via carrier email-to-SMS gateway with compact
        message (possibly truncated reason, but link never truncated).
        """
        # Set up patient with phone and carrier
        self.patient.phone = PHONE
        self.patient.sms_carrier = "verizon"
        self.patient.save()

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancel succeeds
        self.assertEqual(response.status_code, 200, response.content)

        # Two sends: email + SMS
        self.assertEqual(mock_send.call_count, 2)

        # First call is to patient email
        email_to, _, _ = mock_send.call_args_list[0][0]
        self.assertEqual(email_to, self.patient.email)

        # Second call is to SMS gateway (digits-only phone @ gateway domain)
        sms_to, _, sms_text = mock_send.call_args_list[1][0]
        self.assertEqual(sms_to, "15551234567@vtext.com")

        # SMS text is compact (<=160 chars) and includes the link
        self.assertLessEqual(len(sms_text), 160)
        self.assertIn("cancelled", sms_text)
        self.assertIn(REASON, sms_text)  # reason fits in this test
        self.assertIn("https://app.example.com/patient/appointments", sms_text)

        # Response shows both sent
        self.assertEqual(
            response.json()["notification"],
            {
                "email_sent": True,
                "email_failed": False,
                "sms_attempted": True,
                "sms_sent": True,
                "sms_skipped_reason": None,
                "rate_limited": False,
            },
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_4_sms_silently_skipped_when_phone_missing(self, mock_send):
        """Acceptance criterion 4: When patient has no phone, SMS is silently
        skipped (not an error), email still sent, and doctor sees no false
        warning for this expected case.
        """
        # Patient has carrier but no phone
        self.patient.phone = ""
        self.patient.sms_carrier = "verizon"
        self.patient.save()

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancel succeeds
        self.assertEqual(response.status_code, 200, response.content)

        # Only email was sent (one call)
        mock_send.assert_called_once()
        to, _, _ = mock_send.call_args[0]
        self.assertEqual(to, self.patient.email)

        # Response shows SMS was skipped (not attempted), no failure
        notification = response.json()["notification"]
        self.assertEqual(notification["email_sent"], True)
        self.assertEqual(notification["email_failed"], False)
        self.assertEqual(notification["sms_attempted"], False)
        self.assertEqual(notification["sms_sent"], False)
        self.assertEqual(notification["sms_skipped_reason"], "no_phone")

    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_4_sms_silently_skipped_when_carrier_missing(self, mock_send):
        """Acceptance criterion 4: When patient has no carrier, SMS is
        silently skipped, email still sent, no false warning.
        """
        # Patient has phone but no carrier
        self.patient.phone = PHONE
        self.patient.sms_carrier = ""
        self.patient.save()

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancel succeeds
        self.assertEqual(response.status_code, 200, response.content)

        # Only email was sent
        mock_send.assert_called_once()
        to, _, _ = mock_send.call_args[0]
        self.assertEqual(to, self.patient.email)

        # Response shows SMS was skipped, not attempted
        notification = response.json()["notification"]
        self.assertEqual(notification["sms_attempted"], False)
        self.assertEqual(notification["sms_skipped_reason"], "no_carrier")

    @patch("bookings.notifications.send_email")
    def test_criterion_5_email_failure_doesnt_rollback_cancellation_or_change_status_code(
        self, mock_send
    ):
        """Acceptance criterion 5: If email send fails, the cancellation still
        stands (never rolled back) and doctor sees a 200 with a warning flag,
        not a 500.
        """

        def send_side_effect(to, subject, text, *, timeout=10):
            # Email send fails
            raise Exception("Resend API is down")

        mock_send.side_effect = send_side_effect

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Status is 200, not 500
        self.assertEqual(response.status_code, 200, response.content)

        # Cancellation succeeded despite email failure
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, REASON)

        # Response shows the email failed
        notification = response.json()["notification"]
        self.assertEqual(notification["email_sent"], False)
        self.assertEqual(notification["email_failed"], True)

    @patch("bookings.notifications.send_email")
    def test_criterion_6_sms_failure_shows_independent_warning(self, mock_send):
        """Acceptance criterion 6: If SMS send fails (but was genuinely
        attempted — phone+carrier were present), doctor sees a warning
        specific to SMS, independent of email warning (both can show
        simultaneously).
        """

        def send_side_effect(to, subject, text, *, timeout=10):
            # Email succeeds, SMS fails
            if "@" in to and ".com" in to and "vtext" in to:
                raise Exception("SMS gateway down")
            return True

        mock_send.side_effect = send_side_effect
        self.patient.phone = PHONE
        self.patient.sms_carrier = "verizon"
        self.patient.save()

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancel succeeds with 200
        self.assertEqual(response.status_code, 200, response.content)

        # Response shows email succeeded, SMS failed
        notification = response.json()["notification"]
        self.assertEqual(notification["email_sent"], True)
        self.assertEqual(notification["email_failed"], False)
        self.assertEqual(notification["sms_attempted"], True)
        self.assertEqual(notification["sms_sent"], False)
        self.assertEqual(notification["sms_skipped_reason"], "send_failed")

    @patch("bookings.notifications.send_email")
    def test_criterion_6_both_email_and_sms_failures_show_both_warnings(self, mock_send):
        """Acceptance criterion 6: When both email and SMS fail, doctor sees
        both warnings independently.
        """
        mock_send.side_effect = Exception("All sends failed")
        self.patient.phone = PHONE
        self.patient.sms_carrier = "verizon"
        self.patient.save()

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancel succeeds
        self.assertEqual(response.status_code, 200, response.content)

        # Response shows both failed independently
        notification = response.json()["notification"]
        self.assertEqual(notification["email_sent"], False)
        self.assertEqual(notification["email_failed"], True)
        self.assertEqual(notification["sms_attempted"], True)
        self.assertEqual(notification["sms_sent"], False)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_7_patient_sees_reason_on_cancelled_appointment(self, mock_send):
        """Acceptance criterion 7: The reason is visible to patient in-app on
        their cancelled booking via GET /bookings/mine.
        """
        self.login_as(self.provider)

        # Doctor cancels
        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Patient queries their bookings
        self.login_as(self.patient)
        response = self.client.get("/bookings/mine")

        self.assertEqual(response.status_code, 200)
        bookings = response.json()
        self.assertEqual(len(bookings), 1)

        # The reason is present on the patient's view
        self.assertEqual(bookings[0]["cancellation_reason"], REASON)
        self.assertEqual(bookings[0]["status"], "cancelled")

    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_8_reason_not_in_audit_log(self, mock_send):
        """Acceptance criterion 8: The reason is NOT written to the audit log
        (only to Booking.cancellation_reason). The audit entry records
        initiated_by_role only, never the reason text (no PHI in logs).
        """
        self.login_as(self.provider)

        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Find the audit entry for this cancellation
        entry = AuditLog.objects.get(action="status:confirmed->cancelled")

        # Audit metadata records the role, not the reason
        self.assertEqual(entry.metadata["initiated_by_role"], "provider")

        # The reason text is NOT in the audit metadata
        self.assertNotIn(REASON, str(entry.metadata))

    @patch("bookings.notifications.send_email")
    def test_criterion_9_patient_self_cancel_requires_no_reason_sends_no_notification(
        self, mock_send
    ):
        """Acceptance criterion 9: Patient-initiated self-cancellation requires
        NO reason and sends NO notification. This behavior is completely
        unchanged from before this feature existed.
        """
        self.login_as(self.patient)

        # Patient cancels via their own endpoint, NO reason parameter
        response = self.patch_json(f"/bookings/{self.booking.id}/cancel", {})

        # Cancel succeeds
        self.assertEqual(response.status_code, 200, response.content)

        # Reason field is empty
        self.assertEqual(response.json()["cancellation_reason"], "")

        # No notification was sent (send_email never called)
        mock_send.assert_not_called()

        # Booking is cancelled
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_10_24h_notice_rule_still_enforced(self, mock_send):
        """Acceptance criterion 10: The 24-hour minimum cancellation notice
        rule continues to work exactly as before (rejects the transition
        before the notification is sent).
        """
        # Booking starts in 1 hour (inside the 24h window)
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )

        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{soon_booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Cancellation is rejected
        self.assertEqual(response.status_code, 400)
        self.assertIn("24 hours", response.json()["detail"])

        # Booking is still confirmed
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(soon_booking.cancellation_reason, "")

        # No notification was attempted (the guard runs before notify)
        mock_send.assert_not_called()

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_11_patient_sets_carrier_in_profile_persists_and_used(
        self, mock_send
    ):
        """Acceptance criterion 11: Patient can set their mobile carrier in
        profile settings (PATCH /profile) from the fixed list of 9 carriers,
        and it correctly round-trips through a subsequent cancellation where
        the carrier is used for SMS.
        """
        self.login_as(self.patient)

        # Patient sets their phone and carrier in profile
        self.patient.phone = PHONE
        self.patient.save()

        profile_response = self.patch_json(
            "/profile",
            {"phone": PHONE, "sms_carrier": "att"},
        )

        # Carrier is persisted
        self.assertEqual(profile_response.status_code, 200)
        self.assertEqual(profile_response.json()["sms_carrier"], "att")

        # Doctor cancels
        self.login_as(self.provider)

        cancel_response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # SMS was sent (proves the carrier round-tripped correctly)
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(mock_send.call_count, 2)  # email + SMS

        # SMS went to the correct gateway
        sms_to, _, _ = mock_send.call_args_list[1][0]
        self.assertEqual(sms_to, "15551234567@txt.att.net")  # AT&T gateway

        # Response shows SMS was sent
        self.assertEqual(
            cancel_response.json()["notification"]["sms_sent"], True
        )

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    @patch("bookings.notifications.send_email", return_value=True)
    def test_criterion_2_provider_view_includes_reason_in_list(self, mock_send):
        """Additional test for criterion 2 composition: Doctor can see the
        reason they just entered reflected back in the list of their bookings
        (GET /bookings).
        """
        self.login_as(self.provider)

        # Cancel with reason
        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        # Check list endpoint
        response = self.client.get("/bookings")
        self.assertEqual(response.status_code, 200)

        bookings = response.json()
        self.assertEqual(len(bookings), 1)
        self.assertEqual(bookings[0]["cancellation_reason"], REASON)
        self.assertEqual(bookings[0]["status"], "cancelled")
