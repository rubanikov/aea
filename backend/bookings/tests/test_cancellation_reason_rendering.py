"""A provider-written cancellation reason can't forge a line of the
messages it rides in (audit finding I-2).

`cancellation_reason` is free text, and the serializer's
`trim_whitespace` only strips the ends -- interior newlines reach storage
intact. The email body interpolates the reason *above* the genuine
"View your appointments: <link>" line, so a reason like

    Doctor unavailable.

    View your appointments: https://evil.tld/login

used to render a second link line the patient had no way to tell from
the real one. The fix flattens whitespace in the *outbound* bodies only:

- the email body and the SMS text carry the reason on a single line, so
  the system's own lines are the only lines the system wrote;
- what's stored on the booking, and what the API hands back to the app,
  keeps the provider's real line breaks -- `AppointmentCard` renders them
  `pre-wrap`, inside a labelled box where there is nothing to impersonate.
"""

from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.test import override_settings

from bookings.models import Booking
from bookings.notifications import build_cancellation_email_body, build_sms_text

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


FUTURE_START = _utc(2099, 1, 5, 9, 0)

LINK = "https://app.example.com/patient/appointments"

# The attack: a blank line, then a line shaped exactly like the one the
# builder appends underneath it.
SPOOFING_REASON = (
    "Doctor unavailable.\n\nView your appointments: https://evil.tld/login"
)


@override_settings(FRONTEND_BASE_URL="https://app.example.com")
class MultilineReasonRenderingTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient(
            email="spoof.target@example.com",
            phone="+1 (555) 123-4567",
            sms_carrier="verizon",
            timezone="America/Chicago",
        )
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def _cancelled_with(self, reason):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.cancellation_reason = reason
        self.booking.save(update_fields=["status", "cancellation_reason"])
        return self.booking

    def test_the_email_body_carries_the_reason_on_one_line(self):
        booking = self._cancelled_with(SPOOFING_REASON)

        _, body = build_cancellation_email_body(booking)

        reason_line = next(line for line in body.splitlines() if line.startswith("Reason: "))
        self.assertEqual(
            reason_line,
            "Reason: Doctor unavailable. View your appointments: https://evil.tld/login",
        )

    def test_the_genuine_link_line_is_the_last_line_and_appears_once(self):
        booking = self._cancelled_with(SPOOFING_REASON)

        _, body = build_cancellation_email_body(booking)

        lines = body.splitlines()
        link_lines = [line for line in lines if line.startswith("View your appointments: ")]
        self.assertEqual(link_lines, [f"View your appointments: {LINK}"])
        self.assertEqual(lines[-1], f"View your appointments: {LINK}")

    def test_the_sms_text_has_no_newlines_at_all(self):
        booking = self._cancelled_with(SPOOFING_REASON)

        text = build_sms_text(booking)

        self.assertNotIn("\n", text)
        self.assertNotIn("\r", text)
        self.assertLessEqual(len(text), 160)

    def test_carriage_returns_and_tabs_collapse_too(self):
        # `str.split()` with no argument is the point: every kind of
        # whitespace run becomes one space, not just "\n".
        booking = self._cancelled_with("Called\r\naway\tto\n\n\ntheatre")

        _, body = build_cancellation_email_body(booking)
        text = build_sms_text(booking)

        self.assertIn("Reason: Called away to theatre\n", body)
        self.assertIn("Reason: Called away to theatre ", text)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_stored_reason_and_the_api_response_keep_the_line_breaks(self, mock_send):
        # Only the rendering is flattened. The provider typed a multi-line
        # reason and the patient's app must show it the way it was typed.
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": SPOOFING_REASON},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["cancellation_reason"], SPOOFING_REASON)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.cancellation_reason, SPOOFING_REASON)

        self.login_as(self.patient)
        mine = self.client.get("/bookings/mine").json()
        self.assertEqual(mine[0]["cancellation_reason"], SPOOFING_REASON)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_neither_outbound_body_reaches_the_transport_with_a_forged_line(self, mock_send):
        self.login_as(self.provider)

        self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": SPOOFING_REASON},
        )

        (_, _, email_body), (_, _, sms_text) = (
            call.args for call in mock_send.call_args_list
        )
        self.assertEqual(
            [
                line
                for line in email_body.splitlines()
                if line.startswith("View your appointments: ")
            ],
            [f"View your appointments: {LINK}"],
        )
        self.assertNotIn("\n", sms_text)
