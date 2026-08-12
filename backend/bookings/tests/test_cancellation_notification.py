"""Cancellation always emails the patient (doctor-cancel-reason-notify
ticket 03) -- `bookings.notifications` end to end through `PATCH
/bookings/<id>/status`, plus the literal content checks the brief demands:

- the email renders `start_time` in the *patient's* timezone (proved with
  a patient whose zone differs from the provider's, and across a DST
  boundary), carries the verbatim reason and the portal link, and never
  the patient's name, the provider's name, or the appointment type;
- the response's `notification` dict reports the outcome without ever
  changing the 200 (`email_failed` on a raise, the reminder job's
  "unconfigured is a skip, not a failure" convention on a missing
  `RESEND_API_KEY`);
- the notification only ever fires *after* `transition()` committed -- a
  rejected cancel (notice window) sends nothing.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from bookings.models import Booking
from bookings.notifications import (
    build_cancellation_email_body,
    notify_cancellation,
)

from .helpers import BookingsAPITestCase

User = get_user_model()


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Same far-future anchor convention as `test_cancellation_reason.py` --
# clears the 24h notice window regardless of the real wall-clock date.
FUTURE_START = _utc(2099, 1, 5, 9, 0)

REASON = "Called away to an emergency procedure; please rebook."

# Every patient in this module has no phone number, so ticket 05's SMS
# half of the `notification` dict is always the `no_phone` skip -- the
# SMS-specific behaviour itself lives in `test_cancellation_sms.py`. No
# test here sends a patient more than one notification, so the
# per-recipient budget (`test_cancellation_rate_limit.py`) never bites and
# `rate_limited` is always False.
SMS_SKIPPED_NO_PHONE = {
    "sms_attempted": False,
    "sms_sent": False,
    "sms_skipped_reason": "no_phone",
    "rate_limited": False,
}


class BuildCancellationEmailBodyTests(BookingsAPITestCase):
    """Unit tests on the body builder directly -- content rules, not HTTP."""

    def setUp(self):
        # Provider and patient deliberately in *different* zones: every
        # patient-zone assertion below would pass by accident if both were
        # the same.
        self.provider, self.appointment_type = self.setup_bookable_provider(
            timezone="America/New_York"
        )
        self.patient = self.create_patient(
            name="Alex Confidential Patient", timezone="America/Chicago"
        )

    def _booking(self, start_time):
        return self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=start_time,
            status=Booking.Status.CANCELLED,
        )

    def test_subject_is_the_fixed_cancellation_line(self):
        booking = self._booking(_utc(2026, 8, 18, 15, 0))

        subject, _ = build_cancellation_email_body(booking)

        self.assertEqual(subject, "Your appointment was cancelled")

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_body_renders_the_patients_local_time_not_the_providers(self):
        # 15:00 UTC on 2026-08-18 is 10:00 AM in America/Chicago (patient)
        # but 11:00 AM in America/New_York (provider).
        booking = self._booking(_utc(2026, 8, 18, 15, 0))
        booking.cancellation_reason = REASON
        booking.save(update_fields=["cancellation_reason"])

        _, body = build_cancellation_email_body(booking)

        self.assertIn(
            "Your appointment on Tuesday, August 18, 2026 at 10:00 AM "
            "(America/Chicago) has been cancelled.",
            body,
        )
        self.assertNotIn("11:00 AM", body)
        self.assertNotIn("America/New_York", body)

    @override_settings(FRONTEND_BASE_URL="https://app.example.com")
    def test_body_carries_the_verbatim_reason_and_the_portal_link(self):
        booking = self._booking(_utc(2026, 8, 18, 15, 0))
        booking.cancellation_reason = REASON
        booking.save(update_fields=["cancellation_reason"])

        _, body = build_cancellation_email_body(booking)

        self.assertIn(f"Reason: {REASON}", body)
        self.assertIn(
            "View your appointments: https://app.example.com/patient/appointments", body
        )

    @override_settings(FRONTEND_BASE_URL="https://app.example.com/")
    def test_frontend_base_url_trailing_slash_does_not_double_up(self):
        booking = self._booking(_utc(2026, 8, 18, 15, 0))

        _, body = build_cancellation_email_body(booking)

        self.assertIn("https://app.example.com/patient/appointments", body)
        self.assertNotIn("com//patient", body)

    def test_a_long_reason_is_never_truncated(self):
        long_reason = "y" * 500
        booking = self._booking(_utc(2026, 8, 18, 15, 0))
        booking.cancellation_reason = long_reason
        booking.save(update_fields=["cancellation_reason"])

        _, body = build_cancellation_email_body(booking)

        self.assertIn(long_reason, body)

    def test_body_never_contains_names_or_the_appointment_type(self):
        # The brief's deliberate minimal-content decision, checked
        # literally -- same style as `reminders`' PHI test. The provider's
        # `name` field is set explicitly so its absence is a real check.
        self.provider.name = "Dr. Priya Oncologist"
        self.provider.save(update_fields=["name"])
        booking = self._booking(_utc(2026, 8, 18, 15, 0))
        booking.cancellation_reason = REASON
        booking.save(update_fields=["cancellation_reason"])

        subject, body = build_cancellation_email_body(booking)

        for text in (subject, body):
            self.assertNotIn(self.patient.name, text)
            self.assertNotIn("Alex", text)
            self.assertNotIn(self.provider.name, text)
            self.assertNotIn("Priya", text)
            self.assertNotIn(self.appointment_type.name, text)
            self.assertNotIn("Follow-up", text)

    def test_a_dst_boundary_renders_the_correct_patient_local_time(self):
        # America/New_York leaves DST at 02:00 on 2026-11-01: 14:00 UTC is
        # 10:00 AM EDT the day before the change but 9:00 AM EST after it.
        # zoneinfo resolves both from the tz database -- a fixed-offset
        # conversion would get one of the two wrong.
        patient = self.create_patient(
            email="dst.patient@example.com", timezone="America/New_York"
        )
        before = self.make_booking(
            provider=self.provider,
            patient=patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 10, 31, 14, 0),
            status=Booking.Status.CANCELLED,
        )
        after = self.make_booking(
            provider=self.provider,
            patient=patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 11, 1, 14, 0),
            status=Booking.Status.CANCELLED,
        )

        _, before_body = build_cancellation_email_body(before)
        _, after_body = build_cancellation_email_body(after)

        self.assertIn("Saturday, October 31, 2026 at 10:00 AM (America/New_York)", before_body)
        self.assertIn("Sunday, November 1, 2026 at 9:00 AM (America/New_York)", after_body)

    def test_a_blank_patient_timezone_falls_back_to_utc(self):
        # `User.timezone` defaults to "UTC" but is a plain CharField -- a
        # blank value must not crash the notification path.
        patient = self.create_patient(email="no.zone@example.com", timezone="")
        booking = self.make_booking(
            provider=self.provider,
            patient=patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 18, 15, 0),
            status=Booking.Status.CANCELLED,
        )

        _, body = build_cancellation_email_body(booking)

        self.assertIn("Tuesday, August 18, 2026 at 3:00 PM (UTC)", body)


class ProviderCancelSendsTheEmailTests(BookingsAPITestCase):
    """The API seam: `PATCH /bookings/<id>/status` -> `cancelled` notifies
    the patient exactly once, and the `notification` dict reports the
    outcome without ever changing the 200.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient(email="notify.patient@example.com")
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    def _cancel(self, booking_id):
        return self.patch_json(
            f"/bookings/{booking_id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_a_successful_cancel_sends_exactly_one_email_to_the_patient(self, mock_send):
        self.login_as(self.provider)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200, response.content)
        mock_send.assert_called_once()
        args, _ = mock_send.call_args
        self.assertEqual(args[0], self.patient.email)
        self.assertEqual(args[1], "Your appointment was cancelled")
        self.assertIn(REASON, args[2])

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_happy_path_reports_email_sent(self, mock_send):
        self.login_as(self.provider)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()["notification"],
            {"email_sent": True, "email_failed": False, **SMS_SKIPPED_NO_PHONE},
        )

    @patch("bookings.notifications.send_email", side_effect=Exception("resend exploded"))
    def test_a_send_failure_still_cancels_and_returns_200(self, mock_send):
        self.login_as(self.provider)

        response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()["notification"],
            {"email_sent": False, "email_failed": True, **SMS_SKIPPED_NO_PHONE},
        )
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, REASON)

    @override_settings(RESEND_API_KEY="")
    def test_no_resend_api_key_is_a_skip_not_a_failure(self):
        # No mock at all: the real `send_email` runs, hits its no-key
        # guard, and returns False without ever touching the network --
        # the reminder job's "unconfigured is a skip" convention.
        self.login_as(self.provider)

        with self.assertLogs("bookings.notifications", level="WARNING") as logs:
            response = self._cancel(self.booking.id)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()["notification"],
            {"email_sent": False, "email_failed": False, **SMS_SKIPPED_NO_PHONE},
        )
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        # The skip is visible in logs by booking id -- never by the
        # patient's email address (architecture.md §6, no PHI in logs).
        self.assertTrue(any(str(self.booking.id) in line for line in logs.output))
        self.assertFalse(any(self.patient.email in line for line in logs.output))

    @patch("bookings.notifications.send_email")
    def test_a_rejected_transition_never_notifies(self, mock_send):
        # The notice-window guard raises inside `transition()` before any
        # write -- the notification must fire only after a *committed*
        # cancellation, so a rejected one sends nothing at all.
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )
        self.login_as(self.provider)

        response = self._cancel(soon_booking.id)

        self.assertEqual(response.status_code, 400)
        mock_send.assert_not_called()
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CONFIRMED)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_completed_and_no_show_transitions_never_notify(self, mock_send):
        completed_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2020, 1, 6, 9, 0),
        )
        no_show_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2020, 1, 13, 9, 0),
        )
        self.login_as(self.provider)

        completed_response = self.patch_json(
            f"/bookings/{completed_booking.id}/status", {"status": "completed"}
        )
        no_show_response = self.patch_json(
            f"/bookings/{no_show_booking.id}/status", {"status": "no_show"}
        )

        self.assertEqual(completed_response.status_code, 200, completed_response.content)
        self.assertEqual(no_show_response.status_code, 200, no_show_response.content)
        self.assertNotIn("notification", completed_response.json())
        self.assertNotIn("notification", no_show_response.json())
        mock_send.assert_not_called()


class NotifyCancellationResultShapeTests(BookingsAPITestCase):
    """`notify_cancellation` unit-level: the exact two-key result dict for
    each outcome, and the never-raises guarantee.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
            status=Booking.Status.CANCELLED,
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_success_is_sent_and_not_failed(self, mock_send):
        result = notify_cancellation(self.booking)

        self.assertEqual(
            result, {"email_sent": True, "email_failed": False, **SMS_SKIPPED_NO_PHONE}
        )

    @patch("bookings.notifications.send_email", side_effect=Exception("boom"))
    def test_a_raise_is_swallowed_and_reported_as_failed(self, mock_send):
        result = notify_cancellation(self.booking)

        self.assertEqual(
            result, {"email_sent": False, "email_failed": True, **SMS_SKIPPED_NO_PHONE}
        )

    @patch("bookings.notifications.send_email", return_value=False)
    def test_an_unconfigured_skip_is_neither_sent_nor_failed(self, mock_send):
        result = notify_cancellation(self.booking)

        self.assertEqual(
            result, {"email_sent": False, "email_failed": False, **SMS_SKIPPED_NO_PHONE}
        )


class UnrenderableEmailBodyTests(BookingsAPITestCase):
    """A body that can't even be *built* is a notification failure, not a
    500 (M-1).

    `User.timezone` is a plain `CharField` with no model-level validator --
    `/profile`'s serializer is the only thing that checks it, so Django
    admin and the seed scripts can both write a name `zoneinfo` has never
    heard of. Building the email then raises `ZoneInfoNotFoundError`, and
    it used to raise it *outside* `notify_cancellation`'s `try`: the
    booking was cancelled in the database and the provider got a 500
    telling them it wasn't.
    """

    INVALID_ZONE = "Not/A/RealZone"

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient(
            email="broken.zone@example.com", phone="+1 (555) 123-4567", sms_carrier="verizon"
        )
        # Written straight to the column, the way the admin or a seed
        # script would -- `create_patient` goes through the model, which
        # has nothing to say about the value either, but `.update()` makes
        # the "no serializer was involved" part of the setup explicit.
        User.objects.filter(pk=self.patient.pk).update(timezone=self.INVALID_ZONE)
        self.patient.refresh_from_db()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_cancelling_returns_200_and_the_cancellation_stands(self, mock_send):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertEqual(self.booking.cancellation_reason, REASON)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_unbuildable_email_reports_as_email_failed(self, mock_send):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        notification = response.json()["notification"]
        self.assertFalse(notification["email_sent"])
        self.assertTrue(notification["email_failed"])
        # Nothing was ever handed to the transport -- the failure is in
        # the builder, before any address is chosen.
        mock_send.assert_not_called()

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_sms_half_is_still_reported_independently(self, mock_send):
        # The patient has a phone and a carrier, so the SMS is attempted
        # on its own terms rather than being skipped along with the email.
        # It fails too -- `build_sms_text` reads the same broken zone --
        # but it fails in its own keys, through its own handler.
        self.login_as(self.provider)

        response = self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

        notification = response.json()["notification"]
        self.assertTrue(notification["sms_attempted"])
        self.assertFalse(notification["sms_sent"])
        self.assertEqual(notification["sms_skipped_reason"], "send_failed")

    @patch("bookings.notifications.send_email", return_value=True)
    def test_notify_cancellation_itself_never_raises(self, mock_send):
        # The contract the view leans on, checked directly: whatever goes
        # wrong in here, a dict comes back.
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])

        result = notify_cancellation(self.booking)

        self.assertEqual(result["email_failed"], True)
