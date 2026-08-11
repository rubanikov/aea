"""Unit tests for `bookings.transitions.transition` -- TICKET-08's
architecture.md §4 transition guard, exercised directly against its public
function signature (the seam). `test_booking_status_api.py` covers the same
rules again through the HTTP layer (permissions, status codes, response
shape); this file is about the guard logic and audit-writing itself.
"""

from datetime import datetime
from datetime import timezone as dt_timezone

from django.test import TestCase

from audit.models import AuditLog
from bookings.exceptions import InvalidTransition, NoShowBeforeStartTime
from bookings.models import Booking
from bookings.transitions import ALLOWED_TRANSITIONS, transition

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Both dates are Mondays -- matches `setup_bookable_provider`'s
# `day_of_week=0` availability window, though `transition()` itself never
# looks at availability, only at `booking.start_time` vs. real "now".
PAST_START = _utc(2020, 1, 6, 9, 0)
FUTURE_START = _utc(2099, 1, 5, 9, 0)


class TransitionTestCase(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def _booking(self, *, status, start_time=FUTURE_START):
        return self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=start_time,
            status=status,
        )


class ValidTransitionsSucceedAndAreAuditedTests(TransitionTestCase):
    def test_requested_to_confirmed_succeeds_and_is_audited(self):
        booking = self._booking(status=Booking.Status.REQUESTED)

        result = transition(booking, Booking.Status.CONFIRMED, actor=self.patient)

        self.assertEqual(result.status, Booking.Status.CONFIRMED)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertEqual(entry.action, "status:requested->confirmed")
        self.assertEqual(entry.actor, self.patient)

    def test_requested_to_cancelled_succeeds_and_is_audited(self):
        booking = self._booking(status=Booking.Status.REQUESTED)

        transition(booking, Booking.Status.CANCELLED, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)
        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertEqual(entry.action, "status:requested->cancelled")

    def test_confirmed_to_completed_succeeds_and_is_audited(self):
        booking = self._booking(status=Booking.Status.CONFIRMED, start_time=PAST_START)

        transition(booking, Booking.Status.COMPLETED, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.COMPLETED)
        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertEqual(entry.action, "status:confirmed->completed")
        self.assertEqual(entry.actor, self.provider)

    def test_confirmed_to_cancelled_succeeds_and_is_audited(self):
        booking = self._booking(status=Booking.Status.CONFIRMED)

        transition(booking, Booking.Status.CANCELLED, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)
        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertEqual(entry.action, "status:confirmed->cancelled")

    def test_confirmed_to_no_show_succeeds_once_start_time_has_passed(self):
        booking = self._booking(status=Booking.Status.CONFIRMED, start_time=PAST_START)

        transition(booking, Booking.Status.NO_SHOW, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.NO_SHOW)
        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertEqual(entry.action, "status:confirmed->no_show")

    def test_a_none_actor_is_valid_for_a_system_initiated_transition(self):
        booking = self._booking(status=Booking.Status.REQUESTED)

        transition(booking, Booking.Status.CONFIRMED, actor=None)

        entry = AuditLog.objects.get(target_type="booking", target_id=str(booking.id))
        self.assertIsNone(entry.actor)


class InvalidTransitionsAreRejectedTests(TransitionTestCase):
    def test_cancelled_to_completed_is_rejected_not_silently_ignored(self):
        booking = self._booking(status=Booking.Status.CANCELLED)

        with self.assertRaises(InvalidTransition):
            transition(booking, Booking.Status.COMPLETED, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_completed_is_a_terminal_state(self):
        booking = self._booking(status=Booking.Status.COMPLETED)

        for target in (
            Booking.Status.REQUESTED,
            Booking.Status.CONFIRMED,
            Booking.Status.CANCELLED,
            Booking.Status.NO_SHOW,
        ):
            with self.assertRaises(InvalidTransition):
                transition(booking, target, actor=self.provider)

    def test_no_show_is_a_terminal_state(self):
        booking = self._booking(status=Booking.Status.NO_SHOW, start_time=PAST_START)

        with self.assertRaises(InvalidTransition):
            transition(booking, Booking.Status.CONFIRMED, actor=self.provider)

    def test_confirmed_to_confirmed_is_rejected(self):
        booking = self._booking(status=Booking.Status.CONFIRMED)

        with self.assertRaises(InvalidTransition):
            transition(booking, Booking.Status.CONFIRMED, actor=self.provider)

    def test_requested_to_completed_is_rejected(self):
        booking = self._booking(status=Booking.Status.REQUESTED)

        with self.assertRaises(InvalidTransition):
            transition(booking, Booking.Status.COMPLETED, actor=self.provider)

    def test_requested_to_no_show_is_rejected(self):
        booking = self._booking(status=Booking.Status.REQUESTED, start_time=PAST_START)

        with self.assertRaises(InvalidTransition):
            transition(booking, Booking.Status.NO_SHOW, actor=self.provider)

    def test_invalid_transition_message_names_both_statuses(self):
        booking = self._booking(status=Booking.Status.CANCELLED)

        with self.assertRaises(InvalidTransition) as ctx:
            transition(booking, Booking.Status.COMPLETED, actor=self.provider)

        self.assertIn("cancelled", str(ctx.exception))
        self.assertIn("completed", str(ctx.exception))


class NoShowTimingRuleTests(TransitionTestCase):
    def test_no_show_on_a_future_dated_confirmed_booking_is_rejected(self):
        booking = self._booking(status=Booking.Status.CONFIRMED, start_time=FUTURE_START)

        with self.assertRaises(NoShowBeforeStartTime):
            transition(booking, Booking.Status.NO_SHOW, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_no_show_on_a_past_dated_confirmed_booking_succeeds(self):
        booking = self._booking(status=Booking.Status.CONFIRMED, start_time=PAST_START)

        transition(booking, Booking.Status.NO_SHOW, actor=self.provider)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.NO_SHOW)


class AllowedTransitionsTableTests(TestCase):
    def test_matches_architecture_md_section_4_exactly(self):
        self.assertEqual(
            ALLOWED_TRANSITIONS,
            {
                Booking.Status.REQUESTED: {Booking.Status.CONFIRMED, Booking.Status.CANCELLED},
                Booking.Status.CONFIRMED: {
                    Booking.Status.COMPLETED,
                    Booking.Status.CANCELLED,
                    Booking.Status.NO_SHOW,
                },
                Booking.Status.COMPLETED: set(),
                Booking.Status.CANCELLED: set(),
                Booking.Status.NO_SHOW: set(),
            },
        )
