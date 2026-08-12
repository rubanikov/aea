"""Two limits stand between a cancel/rebook loop and an inbox (audit
finding I-1):

- `bookings.views.CancellationRateThrottle` -- how fast one *account* may
  cancel (`DEFAULT_THROTTLE_RATES["booking_cancel"]`), scoped to
  cancellations so `completed`/`no_show` changes, which send nothing, are
  untouched;
- `bookings.notifications.RECIPIENT_HOURLY_NOTIFICATION_BUDGET` -- how
  many cancellation notifications one *patient* may be sent in an hour,
  counted through `CancellationNotificationLog` so a fresh booking id (or
  a second provider) doesn't buy another one.

Neither ever costs a patient their cancellation: an over-budget cancel
still returns 200 and still cancels, it just doesn't send.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.core.cache import cache
from django.utils import timezone

from bookings.models import Booking, CancellationNotificationLog
from bookings.notifications import (
    RECIPIENT_HOURLY_NOTIFICATION_BUDGET,
    notify_cancellation,
)

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


FUTURE_START = _utc(2099, 1, 5, 9, 0)

REASON = "Called away to an emergency procedure; please rebook."

# settings.py: DEFAULT_THROTTLE_RATES["booking_cancel"].
CANCEL_RATE_PER_MINUTE = 10


class CancelThrottleTests(BookingsAPITestCase):
    """Part A -- the scoped endpoint throttle."""

    def setUp(self):
        # Throttle counters live in the default cache, which the test
        # runner doesn't reset between tests (see
        # accounts/tests/test_throttle.py). `login_as` clears it too, so
        # the login below has to happen before the burst, not inside it.
        cache.clear()
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient(email="throttled.patient@example.com")
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START,
        )
        self.login_as(self.provider)

    def tearDown(self):
        cache.clear()

    def _cancel(self):
        return self.patch_json(
            f"/bookings/{self.booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_nth_rapid_cancel_request_is_throttled(self, mock_send):
        # Only the first one actually transitions anything -- the rest are
        # 400s off the already-cancelled booking. The throttle counts
        # requests, not successful transitions, which is the point: a
        # relay loop's requests all count even when most of them fail.
        for attempt in range(CANCEL_RATE_PER_MINUTE):
            with self.subTest(attempt=attempt):
                self.assertNotEqual(self._cancel().status_code, 429)

        self.assertEqual(self._cancel().status_code, 429)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_throttle_does_not_reach_completed_or_no_show_changes(self, mock_send):
        past_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2020, 1, 6, 9, 0),
        )
        for _ in range(CANCEL_RATE_PER_MINUTE + 1):
            self._cancel()

        response = self.patch_json(
            f"/bookings/{past_booking.id}/status", {"status": "completed"}
        )

        self.assertEqual(response.status_code, 200, response.content)


class RecipientNotificationBudgetTests(BookingsAPITestCase):
    """Part B -- the per-recipient hourly budget."""

    def setUp(self):
        cache.clear()
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient(email="bombed.patient@example.com")
        self.login_as(self.provider)

    def tearDown(self):
        cache.clear()

    def _booking(self, index):
        # Distinct start times: two active bookings can't share a
        # provider + start_time (`unique_active_booking_per_provider_slot`).
        return self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START + timedelta(days=index),
        )

    def _cancel(self, booking):
        return self.patch_json(
            f"/bookings/{booking.id}/status",
            {"status": "cancelled", "cancellation_reason": REASON},
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_sends_stop_at_the_budget_but_cancellations_do_not(self, mock_send):
        bookings = [self._booking(i) for i in range(RECIPIENT_HOURLY_NOTIFICATION_BUDGET + 2)]

        for index, booking in enumerate(bookings):
            with self.subTest(index=index):
                response = self._cancel(booking)

                self.assertEqual(response.status_code, 200, response.content)
                booking.refresh_from_db()
                self.assertEqual(booking.status, Booking.Status.CANCELLED)

        # One send per allowed notification, then nothing -- the last two
        # cancels never reached the transport.
        self.assertEqual(mock_send.call_count, RECIPIENT_HOURLY_NOTIFICATION_BUDGET)

    @patch("bookings.notifications.send_email", return_value=True)
    def test_an_over_budget_cancel_reports_rate_limited_not_failed(self, mock_send):
        for index in range(RECIPIENT_HOURLY_NOTIFICATION_BUDGET):
            self._cancel(self._booking(index))

        response = self._cancel(self._booking(RECIPIENT_HOURLY_NOTIFICATION_BUDGET))

        self.assertEqual(
            response.json()["notification"],
            {
                "email_sent": False,
                # Nothing failed -- we chose not to send.
                "email_failed": False,
                "sms_attempted": False,
                "sms_sent": False,
                "sms_skipped_reason": "rate_limited",
                "rate_limited": True,
            },
        )

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_budget_follows_the_patient_not_the_booking(self, mock_send):
        # The whole point of keying the log on the patient: every cycle of
        # a cancel/rebook loop presents a booking id the counter has never
        # seen, and it still doesn't buy a send.
        for index in range(RECIPIENT_HOURLY_NOTIFICATION_BUDGET):
            self._cancel(self._booking(index))
        mock_send.reset_mock()

        self._cancel(self._booking(RECIPIENT_HOURLY_NOTIFICATION_BUDGET))

        mock_send.assert_not_called()

    @patch("bookings.notifications.send_email", return_value=True)
    def test_another_patients_notifications_are_unaffected(self, mock_send):
        for index in range(RECIPIENT_HOURLY_NOTIFICATION_BUDGET + 1):
            self._cancel(self._booking(index))
        other_patient = self.create_patient(email="untouched.patient@example.com")
        other_booking = self.make_booking(
            provider=self.provider,
            patient=other_patient,
            appointment_type=self.appointment_type,
            start_time=FUTURE_START + timedelta(days=100),
        )
        mock_send.reset_mock()

        response = self._cancel(other_booking)

        mock_send.assert_called_once()
        self.assertTrue(response.json()["notification"]["email_sent"])

    @patch("bookings.notifications.send_email", return_value=True)
    def test_the_window_only_counts_the_last_hour(self, mock_send):
        booking = self._booking(0)
        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=["status"])
        stale = [
            CancellationNotificationLog.objects.create(patient=self.patient)
            for _ in range(RECIPIENT_HOURLY_NOTIFICATION_BUDGET)
        ]
        CancellationNotificationLog.objects.filter(
            pk__in=[row.pk for row in stale]
        ).update(created_at=timezone.now() - timedelta(hours=2))

        result = notify_cancellation(booking)

        self.assertFalse(result["rate_limited"])
        self.assertTrue(result["email_sent"])
