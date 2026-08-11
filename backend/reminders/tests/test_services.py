"""`reminders.services.dispatch_due_reminders` -- the selection/dedup/send/
log loop, this ticket's core acceptance criteria. `send_reminder_email` is
mocked throughout (this file's seam is the dispatch loop, not the Resend
HTTP call itself -- see `test_emails.py` for that).
"""

from datetime import timedelta
from unittest.mock import patch

from bookings.models import Booking
from reminders.emails import SendReminderEmailError
from reminders.models import ReminderLog
from reminders.services import (
    WINDOW_END_OFFSET,
    WINDOW_START_OFFSET,
    dispatch_due_reminders,
)
from scheduling.models import AppointmentType

from .helpers import RemindersTestCase, utc

NOW = utc(2026, 8, 17, 9, 0)


class DispatchDueRemindersTestCase(RemindersTestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=30
        )

    def _booking(self, *, start_time, status=Booking.Status.CONFIRMED, patient=None):
        return self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=start_time,
            patient=patient or self.patient,
            status=status,
        )


class ADueConfirmedBookingGetsExactlyOneReminderTests(DispatchDueRemindersTestCase):
    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_confirmed_booking_due_in_the_window_gets_one_log_row_and_one_send(
        self, mock_send
    ):
        booking = self._booking(start_time=NOW + timedelta(hours=24))

        summary = dispatch_due_reminders(now=NOW)

        mock_send.assert_called_once_with(booking)
        self.assertEqual(summary.sent, 1)
        self.assertEqual(summary.considered, 1)
        logs = ReminderLog.objects.filter(booking=booking, interval=ReminderLog.INTERVAL_24H)
        self.assertEqual(logs.count(), 1)

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_running_dispatch_twice_sends_only_once(self, mock_send):
        booking = self._booking(start_time=NOW + timedelta(hours=24))

        first = dispatch_due_reminders(now=NOW)
        second = dispatch_due_reminders(now=NOW)

        self.assertEqual(first.sent, 1)
        self.assertEqual(second.sent, 0)
        self.assertEqual(second.considered, 0)
        mock_send.assert_called_once_with(booking)
        self.assertEqual(
            ReminderLog.objects.filter(booking=booking, interval=ReminderLog.INTERVAL_24H).count(),
            1,
        )


class WindowBoundaryTests(DispatchDueRemindersTestCase):
    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_booking_too_soon_to_be_due_is_not_selected(self, mock_send):
        # Well inside the 23h floor -- e.g. 5h out.
        self._booking(start_time=NOW + timedelta(hours=5))

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()
        self.assertEqual(ReminderLog.objects.count(), 0)

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_booking_too_far_out_is_not_selected(self, mock_send):
        # Well past the 25h ceiling -- e.g. 48h out.
        self._booking(start_time=NOW + timedelta(hours=48))

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_booking_that_has_already_passed_is_not_selected(self, mock_send):
        self._booking(start_time=NOW - timedelta(hours=1))

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_the_window_start_boundary_is_inclusive(self, mock_send):
        self._booking(start_time=NOW + WINDOW_START_OFFSET)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 1)
        mock_send.assert_called_once()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_the_window_end_boundary_is_exclusive(self, mock_send):
        self._booking(start_time=NOW + WINDOW_END_OFFSET)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()


class OnlyConfirmedBookingsAreSelectedTests(DispatchDueRemindersTestCase):
    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_cancelled_booking_is_never_selected(self, mock_send):
        self._booking(start_time=NOW + timedelta(hours=24), status=Booking.Status.CANCELLED)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_completed_booking_is_never_selected(self, mock_send):
        self._booking(start_time=NOW + timedelta(hours=24), status=Booking.Status.COMPLETED)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_requested_booking_is_never_selected(self, mock_send):
        self._booking(start_time=NOW + timedelta(hours=24), status=Booking.Status.REQUESTED)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_a_no_show_booking_is_never_selected(self, mock_send):
        self._booking(start_time=NOW + timedelta(hours=24), status=Booking.Status.NO_SHOW)

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.considered, 0)
        mock_send.assert_not_called()


class FailedAndSkippedSendsDoNotCreateALogRowTests(DispatchDueRemindersTestCase):
    @patch("reminders.services.send_reminder_email", side_effect=SendReminderEmailError("boom"))
    def test_a_send_failure_is_logged_and_does_not_create_a_reminder_log_row(self, mock_send):
        booking = self._booking(start_time=NOW + timedelta(hours=24))

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.failed, 1)
        self.assertEqual(summary.sent, 0)
        self.assertEqual(ReminderLog.objects.filter(booking=booking).count(), 0)

    @patch("reminders.services.send_reminder_email", side_effect=SendReminderEmailError("boom"))
    def test_a_failed_send_is_retried_on_the_next_run(self, mock_send):
        booking = self._booking(start_time=NOW + timedelta(hours=24))
        dispatch_due_reminders(now=NOW)

        mock_send.side_effect = None
        mock_send.return_value = True
        second = dispatch_due_reminders(now=NOW)

        self.assertEqual(second.sent, 1)
        self.assertEqual(
            ReminderLog.objects.filter(booking=booking, interval=ReminderLog.INTERVAL_24H).count(),
            1,
        )

    @patch("reminders.services.send_reminder_email", return_value=False)
    def test_a_skipped_send_no_api_key_does_not_create_a_reminder_log_row(self, mock_send):
        booking = self._booking(start_time=NOW + timedelta(hours=24))

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.skipped, 1)
        self.assertEqual(summary.sent, 0)
        self.assertEqual(ReminderLog.objects.filter(booking=booking).count(), 0)


class MultipleDueBookingsTests(DispatchDueRemindersTestCase):
    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_each_due_booking_gets_its_own_log_row(self, mock_send):
        other_patient = self.create_patient(email="other-patient@example.com")
        booking_one = self._booking(start_time=NOW + timedelta(hours=23, minutes=30))
        booking_two = self._booking(
            start_time=NOW + timedelta(hours=24, minutes=30), patient=other_patient
        )

        summary = dispatch_due_reminders(now=NOW)

        self.assertEqual(summary.sent, 2)
        self.assertEqual(mock_send.call_count, 2)
        self.assertTrue(
            ReminderLog.objects.filter(booking=booking_one, interval=ReminderLog.INTERVAL_24H)
            .exists()
        )
        self.assertTrue(
            ReminderLog.objects.filter(booking=booking_two, interval=ReminderLog.INTERVAL_24H)
            .exists()
        )
