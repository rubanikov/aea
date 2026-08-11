"""`ReminderLog`'s `UniqueConstraint(booking, interval)` -- architecture.md
§7's actual dedup guarantee, exercised directly at the model layer, same
style as `bookings/tests/test_models.py`'s constraint tests. The
concurrency-under-load version of this same guarantee lives in
`reminders/tests/test_concurrency.py`.
"""

from django.db import IntegrityError, transaction

from bookings.models import Booking
from reminders.models import ReminderLog
from scheduling.models import AppointmentType

from .helpers import RemindersTestCase, utc


class ReminderLogConstraintTests(RemindersTestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=utc(2026, 8, 18, 9, 0),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )

    def test_a_second_log_row_for_the_same_booking_and_interval_is_rejected(self):
        ReminderLog.objects.create(booking=self.booking, interval=ReminderLog.INTERVAL_24H)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ReminderLog.objects.create(
                    booking=self.booking, interval=ReminderLog.INTERVAL_24H
                )

        self.assertEqual(ReminderLog.objects.filter(booking=self.booking).count(), 1)

    def test_the_same_booking_can_have_log_rows_for_different_intervals(self):
        # Only one interval is used by `reminders.services` today, but the
        # constraint itself is scoped per-interval, not "one row per
        # booking, full stop" -- assert that directly rather than only
        # through today's single-interval usage.
        ReminderLog.objects.create(booking=self.booking, interval="24h")

        ReminderLog.objects.create(booking=self.booking, interval="1h")

        self.assertEqual(ReminderLog.objects.filter(booking=self.booking).count(), 2)

    def test_different_bookings_can_each_have_their_own_24h_log_row(self):
        other_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=utc(2026, 8, 18, 10, 0),
            patient=self.patient,
            status=Booking.Status.CONFIRMED,
        )
        ReminderLog.objects.create(booking=self.booking, interval=ReminderLog.INTERVAL_24H)

        ReminderLog.objects.create(booking=other_booking, interval=ReminderLog.INTERVAL_24H)

        self.assertEqual(ReminderLog.objects.count(), 2)

    def test_sent_at_is_set_automatically_on_create(self):
        log = ReminderLog.objects.create(booking=self.booking, interval=ReminderLog.INTERVAL_24H)

        self.assertIsNotNone(log.sent_at)

    def test_deleting_a_booking_cascades_to_its_reminder_logs(self):
        ReminderLog.objects.create(booking=self.booking, interval=ReminderLog.INTERVAL_24H)

        self.booking.delete()

        self.assertEqual(ReminderLog.objects.count(), 0)
