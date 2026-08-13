"""`reminders.emails` -- the Resend seam and the PHI-free email content
itself (this ticket's brief: "assert the sent content doesn't include the
patient's name/appointment type — a literal test, not just a design
intention").
"""

import json
from unittest.mock import MagicMock, patch
from urllib import error

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from bookings.models import Booking
from reminders.emails import (
    SendReminderEmailError,
    build_reminder_email_body,
    send_reminder_email,
)
from scheduling.models import AppointmentType

from .helpers import RemindersTestCase, utc


class ReminderEmailBodyContentTests(RemindersTestCase):
    """A literal, content-level PHI check -- not just "the code doesn't
    pass these fields," but "the rendered string genuinely never contains
    the patient's name or the appointment type."
    """

    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient(name="Alex Confidential Patient")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Sensitive Diagnosis Follow-up"
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=utc(2026, 8, 18, 9, 0),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_body_does_not_contain_patient_name_or_appointment_type(self):
        body = build_reminder_email_body(self.booking)

        self.assertNotIn(self.patient.name, body)
        self.assertNotIn(self.appointment_type.name, body)
        self.assertNotIn("Sensitive", body)
        self.assertNotIn("Diagnosis", body)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_body_contains_a_generic_notice_and_a_link_to_the_frontend(self):
        # Regression (doctor-cancel-reason-notify ticket 03's approved
        # fix): the link is the frontend's real `/patient/appointments`
        # page -- the old `/appointments/{id}` route never existed.
        body = build_reminder_email_body(self.booking)

        self.assertIn("upcoming appointment", body)
        self.assertIn("https://app.example.com/patient/appointments", body)
        self.assertNotIn(f"/appointments/{self.booking.id}", body)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com/")
    def test_frontend_base_url_trailing_slash_does_not_double_up(self):
        body = build_reminder_email_body(self.booking)

        self.assertIn("https://app.example.com/patient/appointments", body)
        self.assertNotIn("com//patient", body)


class SendReminderEmailNoApiKeyTests(RemindersTestCase):
    """This ticket's deliberate "skip and log" choice for an unset
    RESEND_API_KEY -- see reminders/emails.py's `send_reminder_email`
    docstring and reminders/README.md for the reasoning.
    """

    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up"
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=utc(2026, 8, 18, 9, 0),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )

    @override_settings(RESEND_API_KEY="")
    def test_returns_false_and_does_not_raise_when_no_api_key_is_configured(self):
        with self.assertLogs("reminders.emails", level="WARNING") as logs:
            result = send_reminder_email(self.booking)

        self.assertFalse(result)
        self.assertIn(str(self.booking.id), logs.output[0])

    @override_settings(RESEND_API_KEY="")
    @patch("reminders.emails.request.urlopen")
    def test_no_http_call_is_made_when_no_api_key_is_configured(self, mock_urlopen):
        send_reminder_email(self.booking)

        mock_urlopen.assert_not_called()


class SendReminderEmailHttpCallTests(TestCase):
    """`send_reminder_email`'s actual HTTP call to Resend -- mocked at
    `urllib.request.urlopen`, one level below the seam
    `reminders.services.dispatch_due_reminders` itself mocks (that seam is
    `send_reminder_email` as a whole; these tests are about what happens
    *inside* it).
    """

    def _booking(self):
        User = get_user_model()
        provider = User.objects.create_user(
            email="provider-email@example.com", password="x", role=User.Role.PROVIDER
        )
        patient = User.objects.create_user(
            email="patient-email@example.com", password="x", role=User.Role.PATIENT
        )
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up"
        )
        return Booking.objects.create(
            provider=provider,
            patient=patient,
            appointment_type=appointment_type,
            start_time=utc(2026, 8, 18, 9, 0),
            end_time=utc(2026, 8, 18, 9, 30),
            status=Booking.Status.CONFIRMED,
        )

    @override_settings(RESEND_API_KEY="test-key", RESEND_FROM_EMAIL="reminders@example.com")
    @patch("reminders.emails.request.urlopen")
    def test_a_2xx_response_returns_true_and_posts_the_expected_payload(self, mock_urlopen):
        booking = self._booking()
        mock_response = MagicMock()
        mock_response.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_response

        result = send_reminder_email(booking)

        self.assertTrue(result)
        sent_request = mock_urlopen.call_args[0][0]
        self.assertEqual(sent_request.full_url, "https://api.resend.com/emails")
        self.assertEqual(sent_request.get_header("Authorization"), "Bearer test-key")
        payload = json.loads(sent_request.data)
        self.assertEqual(payload["to"], [booking.patient.email])
        self.assertEqual(payload["from"], "reminders@example.com")
        self.assertNotIn(booking.appointment_type.name, payload["text"])

    @override_settings(RESEND_API_KEY="test-key")
    @patch("reminders.emails.request.urlopen")
    def test_a_non_2xx_status_raises_send_reminder_email_error(self, mock_urlopen):
        booking = self._booking()
        mock_response = MagicMock()
        mock_response.status = 500
        mock_urlopen.return_value.__enter__.return_value = mock_response

        with self.assertRaises(SendReminderEmailError):
            send_reminder_email(booking)

    @override_settings(RESEND_API_KEY="test-key")
    @patch("reminders.emails.request.urlopen")
    def test_an_http_error_raises_send_reminder_email_error(self, mock_urlopen):
        booking = self._booking()
        mock_urlopen.side_effect = error.HTTPError(
            "https://api.resend.com/emails", 401, "Unauthorized", {}, None
        )

        with self.assertRaises(SendReminderEmailError):
            send_reminder_email(booking)

    @override_settings(RESEND_API_KEY="test-key")
    @patch("reminders.emails.request.urlopen")
    def test_a_network_error_raises_send_reminder_email_error(self, mock_urlopen):
        booking = self._booking()
        mock_urlopen.side_effect = error.URLError("connection refused")

        with self.assertRaises(SendReminderEmailError):
            send_reminder_email(booking)
