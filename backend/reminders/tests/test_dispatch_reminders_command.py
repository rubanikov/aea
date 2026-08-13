"""`dispatch_reminders` -- the Railway cron entry point. A thin wrapper, so
this only checks it calls through to `dispatch_due_reminders` and prints a
summary; the dispatch logic itself is `test_services.py`'s job.
"""

from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command

from bookings.models import Booking
from scheduling.models import AppointmentType

from .helpers import RemindersTestCase, utc

NOW = utc(2026, 8, 17, 9, 0)


class DispatchRemindersCommandTests(RemindersTestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up"
        )

    @patch("reminders.services.send_reminder_email", return_value=True)
    def test_prints_a_summary_of_the_dispatch_run(self, mock_send):
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=NOW + timedelta(hours=24),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )
        out = StringIO()

        with patch("reminders.management.commands.dispatch_reminders.dispatch_due_reminders") \
                as mock_dispatch:
            from reminders.services import DispatchSummary

            mock_dispatch.return_value = DispatchSummary(
                considered=1, sent=1, skipped=0, failed=0, already_logged=0
            )
            call_command("dispatch_reminders", stdout=out)

        mock_dispatch.assert_called_once_with()
        output = out.getvalue()
        self.assertIn("considered=1", output)
        self.assertIn("sent=1", output)

    def test_actually_dispatches_real_due_reminders_end_to_end(self):
        # No mocking of dispatch_due_reminders here -- a real (unmocked)
        # run through the command, only the outbound Resend call itself is
        # faked, matching how it'd behave with no RESEND_API_KEY set
        # (skip-and-log, see reminders/emails.py).
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=NOW + timedelta(hours=24),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )
        out = StringIO()

        with patch("reminders.services.send_reminder_email", return_value=True):
            with patch("django.utils.timezone.now", return_value=NOW):
                call_command("dispatch_reminders", stdout=out)

        self.assertIn("sent=1", out.getvalue())
