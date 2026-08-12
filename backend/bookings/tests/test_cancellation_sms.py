"""Cancellation texts the patient when phone + carrier are known
(doctor-cancel-reason-notify ticket 05) -- the SMS half of
`bookings.notifications.notify_cancellation`, delivered through carrier
email-to-SMS gateways over the same `send_email` seam as the email:

- attempted iff `patient.phone` and `patient.sms_carrier` are both set,
  addressed as `{digits-only phone}@{gateway}` for all nine carriers;
- `build_sms_text` fits one 160-char GSM-7 segment by ASCII-folding and
  (only if needed) truncating the *reason* -- never the link, which the
  email meanwhile keeps in full, untruncated original form;
- a skipped or failed SMS extends the result dict (`sms_attempted`,
  `sms_sent`, `sms_skipped_reason`) without ever touching the email keys
  or the 200.
"""

from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings

from bookings.models import Booking
from bookings.notifications import (
    SMS_GATEWAYS,
    build_cancellation_email_body,
    build_sms_text,
    notify_cancellation,
)

from .helpers import BookingsAPITestCase

User = get_user_model()


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Same far-future anchor convention as `test_cancellation_notification.py`.
FUTURE_START = _utc(2099, 1, 5, 9, 0)

REASON = "Called away to an emergency procedure; please rebook."

PHONE = "+1 (555) 123-4567"
DIGITS = "15551234567"


class SmsTestCase(BookingsAPITestCase):
    def make_cancelled_booking(self, *, phone=PHONE, sms_carrier="verizon", **patient_overrides):
        patient = self.create_patient(
            email=f"sms-patient-{Booking.objects.count()}@example.com",
            phone=phone,
            sms_carrier=sms_carrier,
            timezone="America/Chicago",
            **patient_overrides,
        )
        booking = self.make_booking(
            provider=self.provider,
            patient=patient,
            appointment_type=self.appointment_type,
            # 15:00 UTC on 2026-08-18 is 10:00 AM in America/Chicago.
            start_time=_utc(2026, 8, 18, 15, 0),
            status=Booking.Status.CANCELLED,
        )
        booking.cancellation_reason = REASON
        booking.save(update_fields=["cancellation_reason"])
        return booking

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()


class BuildSmsTextTests(SmsTestCase):
    """Unit tests on the pure builder -- content and truncation rules."""

    LINK = "https://app.example.com/patient/appointments"

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_a_short_reason_goes_verbatim_in_compact_patient_local_time(self):
        booking = self.make_cancelled_booking()

        text = build_sms_text(booking)

        self.assertEqual(
            text,
            f"Your appointment on Aug 18 at 10:00 AM was cancelled. Reason: {REASON} {self.LINK}",
        )
        self.assertLessEqual(len(text), 160)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_a_long_reason_is_truncated_with_ascii_ellipsis_to_fit_160(self):
        booking = self.make_cancelled_booking()
        booking.cancellation_reason = "Provider unavailable " * 20
        booking.save(update_fields=["cancellation_reason"])

        text = build_sms_text(booking)

        # overhead = 20 ("Your appointment on ") + 18 (when) + 24
        # (" was cancelled. Reason: ") + 1 + 44 (link) = 107 -> budget 53.
        expected_reason = ("Provider unavailable " * 20)[: 53 - 3].rstrip() + "..."
        self.assertIn(f"Reason: {expected_reason} ", text)
        self.assertNotIn("…", text)  # literal "...", never the ellipsis char
        self.assertLessEqual(len(text), 160)
        self.assertIn(self.LINK, text)  # the link is never truncated

    @override_settings(
        FRONTEND_BASE_URL="https://" + "a" * 60 + ".example.com"
    )
    def test_a_pathologically_long_link_drops_the_reason_clause_not_the_link(self):
        # link = 8 + 60 + 12 + len("/patient/appointments") = 101 chars ->
        # budget = 160 - (20 + 18 + 24 + 1 + 101) = -4, below the 20-char
        # floor for a meaningful reason fragment.
        long_link = "https://" + "a" * 60 + ".example.com/patient/appointments"
        booking = self.make_cancelled_booking()

        text = build_sms_text(booking)

        self.assertEqual(text, f"Your appointment on Aug 18 at 10:00 AM was cancelled. {long_link}")
        self.assertNotIn("Reason:", text)
        self.assertLessEqual(len(text), 160)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_a_non_ascii_reason_is_folded_before_measuring(self):
        booking = self.make_cancelled_booking()
        booking.cancellation_reason = "Dr. Renée said “désolé” \U0001f637"
        booking.save(update_fields=["cancellation_reason"])

        text = build_sms_text(booking)

        self.assertTrue(text.isascii(), text)
        self.assertIn("Reason: Dr. Renee said desole", text)
        self.assertIn(self.LINK, text)
        self.assertLessEqual(len(text), 160)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_the_email_keeps_the_full_original_reason_the_sms_truncated(self):
        # The two builders must not share truncation/folding logic: the
        # email carries the verbatim reason even when the SMS cuts it.
        long_reason = "Emergency détour — " + "x" * 480
        booking = self.make_cancelled_booking()
        booking.cancellation_reason = long_reason
        booking.save(update_fields=["cancellation_reason"])

        _, email_body = build_cancellation_email_body(booking)
        sms_text = build_sms_text(booking)

        self.assertIn(long_reason, email_body)
        self.assertNotIn(long_reason, sms_text)
        self.assertLessEqual(len(sms_text), 160)


class NotifyCancellationSmsTests(SmsTestCase):
    """`notify_cancellation` unit-level: the SMS attempt/skip/failure keys
    alongside ticket 03's email keys."""

    @patch("bookings.notifications.send_email", return_value=True)
    def test_every_carrier_maps_to_its_gateway_address(self, mock_send):
        for carrier, gateway in SMS_GATEWAYS.items():
            with self.subTest(carrier=carrier):
                mock_send.reset_mock()
                booking = self.make_cancelled_booking(sms_carrier=carrier)

                result = notify_cancellation(booking)

                self.assertEqual(mock_send.call_count, 2)  # email, then SMS
                sms_args, _ = mock_send.call_args_list[1]
                self.assertEqual(sms_args[0], f"{DIGITS}@{gateway}")
                self.assertEqual(
                    result,
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
    def test_the_gateway_address_strips_phone_formatting_to_digits(self, mock_send):
        booking = self.make_cancelled_booking(phone="+1 (555) 123-4567")

        notify_cancellation(booking)

        sms_args, _ = mock_send.call_args_list[1]
        self.assertEqual(sms_args[0], "15551234567@vtext.com")

    @patch("bookings.notifications.send_email", return_value=True)
    def test_no_phone_skips_the_sms_but_still_emails(self, mock_send):
        booking = self.make_cancelled_booking(phone="")

        result = notify_cancellation(booking)

        mock_send.assert_called_once()  # the email only
        self.assertEqual(mock_send.call_args[0][0], booking.patient.email)
        self.assertEqual(
            result,
            {
                "email_sent": True,
                "email_failed": False,
                "sms_attempted": False,
                "sms_sent": False,
                "sms_skipped_reason": "no_phone",
                "rate_limited": False,
            },
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_no_carrier_skips_the_sms(self, mock_send):
        booking = self.make_cancelled_booking(sms_carrier="")

        result = notify_cancellation(booking)

        mock_send.assert_called_once()
        self.assertEqual(
            result,
            {
                "email_sent": True,
                "email_failed": False,
                "sms_attempted": False,
                "sms_sent": False,
                "sms_skipped_reason": "no_carrier",
                "rate_limited": False,
            },
        )

    def test_a_failed_sms_send_never_touches_the_email_result(self):
        booking = self.make_cancelled_booking()

        def send(to, subject, text, *, timeout=10):
            if to == booking.patient.email:
                return True
            raise Exception("gateway exploded")

        with patch("bookings.notifications.send_email", side_effect=send):
            result = notify_cancellation(booking)

        self.assertEqual(
            result,
            {
                "email_sent": True,
                "email_failed": False,
                "sms_attempted": True,
                "sms_sent": False,
                "sms_skipped_reason": "send_failed",
                "rate_limited": False,
            },
        )

    def test_a_failed_email_never_stops_the_sms_attempt(self):
        booking = self.make_cancelled_booking()

        def send(to, subject, text, *, timeout=10):
            if to == booking.patient.email:
                raise Exception("resend exploded")
            return True

        with patch("bookings.notifications.send_email", side_effect=send):
            result = notify_cancellation(booking)

        self.assertEqual(
            result,
            {
                "email_sent": False,
                "email_failed": True,
                "sms_attempted": True,
                "sms_sent": True,
                "sms_skipped_reason": None,
                "rate_limited": False,
            },
        )

    def test_a_carrier_with_no_gateway_skips_the_sms(self):
        # Defensive, and unreachable through the API: `sms_carrier`'s
        # `choices` are exactly `SMS_GATEWAYS`' keys and `/profile` won't
        # accept anything else. Written straight to the column here (the
        # way a stale row from a retired carrier, or an admin edit, could
        # produce one) so the branch that catches it is actually covered.
        booking = self.make_cancelled_booking()
        User.objects.filter(pk=booking.patient_id).update(sms_carrier="carrier-pigeon")
        booking.patient.refresh_from_db()

        with patch("bookings.notifications.send_email", return_value=True) as mock_send:
            result = notify_cancellation(booking)

        mock_send.assert_called_once()  # the email only
        self.assertEqual(
            result,
            {
                "email_sent": True,
                "email_failed": False,
                "sms_attempted": False,
                "sms_sent": False,
                "sms_skipped_reason": "unknown_carrier",
                "rate_limited": False,
            },
        )

    @override_settings(RESEND_API_KEY="")
    def test_an_unconfigured_api_key_reports_the_sms_as_send_failed(self):
        # No mock: the real `send_email` runs, hits its no-key guard and
        # returns False for both channels without touching the network.
        # The two halves report it differently, on purpose -- the email
        # has a "skipped, not failed" state to fall into (neither sent nor
        # failed), the SMS contract has no third state, so an unsendable
        # text is `send_failed`. Either way the patient got nothing and
        # nothing raised.
        booking = self.make_cancelled_booking()

        with self.assertLogs("bookings.notifications", level="WARNING") as logs:
            result = notify_cancellation(booking)

        self.assertEqual(
            result,
            {
                "email_sent": False,
                "email_failed": False,
                "sms_attempted": True,
                "sms_sent": False,
                "sms_skipped_reason": "send_failed",
                "rate_limited": False,
            },
        )
        self.assertTrue(any(str(booking.id) in line for line in logs.output))
        self.assertFalse(any(booking.patient.phone in line for line in logs.output))


class ProviderCancelSendsTheSmsTests(SmsTestCase):
    """End to end through `PATCH /bookings/<id>/status`: the response's
    `notification` dict carries the SMS keys with no view changes."""

    @patch("bookings.notifications.send_email", return_value=True)
    def test_a_cancel_with_phone_and_carrier_reports_sms_sent(self, mock_send):
        patient = self.create_patient(
            email="sms.e2e@example.com", phone=PHONE, sms_carrier="tmobile"
        )
        booking = self.make_booking(
            provider=self.provider,
            patient=patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        self.assertEqual(response.status_code, 200, response.content)
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
        sms_args, _ = mock_send.call_args_list[1]
        self.assertEqual(sms_args[0], f"{DIGITS}@tmomail.net")
        self.assertIn(REASON, sms_args[2])
