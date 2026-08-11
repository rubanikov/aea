"""Unit tests for `bookings.transitions.transition` -- TICKET-08's
architecture.md §4 transition guard, exercised directly against its public
function signature (the seam). `test_booking_status_api.py` covers the same
rules again through the HTTP layer (permissions, status codes, response
shape); this file is about the guard logic and audit-writing itself.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.test import TestCase
from django.utils import timezone

from audit.models import AuditLog
from bookings.exceptions import CancellationNoticeTooShort, InvalidTransition, NoShowBeforeStartTime
from bookings.models import Booking
from bookings.transitions import ALLOWED_TRANSITIONS, CANCELLATION_MIN_NOTICE, transition

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


class CancellationNoticeRuleTests(TransitionTestCase):
    """TICKET-09's brief: "no cancel < 24h before start" --
    `bookings.transitions.CANCELLATION_MIN_NOTICE`. Checked only after the
    `ALLOWED_TRANSITIONS` lookup confirms the transition is otherwise
    legal (same ordering as `NoShowTimingRuleTests` above), and uniformly
    regardless of who's cancelling -- see
    `test_notice_rule_applies_regardless_of_actor_role` below.
    """

    def test_cancelling_well_outside_the_notice_window_succeeds(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=48)
        )

        transition(booking, Booking.Status.CANCELLED, actor=self.patient)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)

    def test_cancelling_inside_the_24h_notice_window_is_rejected(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=1)
        )

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_cancelling_a_booking_whose_start_time_has_already_passed_is_rejected(self):
        # Inside the notice window is a strict subset of "hasn't started
        # yet" -- a start_time already in the past is, a fortiori, inside
        # the window too.
        booking = self._booking(status=Booking.Status.CONFIRMED, start_time=PAST_START)

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)

    def test_notice_rule_also_applies_to_a_still_requested_booking(self):
        booking = self._booking(
            status=Booking.Status.REQUESTED, start_time=timezone.now() + timedelta(hours=1)
        )

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)

    def test_notice_rule_applies_regardless_of_actor_role(self):
        # architecture.md doesn't carve out a provider/admin exception --
        # this ticket's judgment call is to treat the rule as universal.
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=1)
        )

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.provider)

    def test_cancellation_notice_error_names_the_24_hour_window(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=1)
        )

        with self.assertRaises(CancellationNoticeTooShort) as ctx:
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)

        self.assertIn("24 hours", str(ctx.exception))

    def test_a_cancellation_just_inside_the_boundary_is_rejected(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED,
            start_time=timezone.now() + CANCELLATION_MIN_NOTICE - timedelta(minutes=1),
        )

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)

    def test_a_cancellation_just_outside_the_boundary_succeeds(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED,
            start_time=timezone.now() + CANCELLATION_MIN_NOTICE + timedelta(minutes=5),
        )

        transition(booking, Booking.Status.CANCELLED, actor=self.patient)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)

    def test_enforce_notice_false_bypasses_the_window(self):
        # The one sanctioned caller of `enforce_notice=False` is
        # `accounts.serializers._cancel_upcoming_appointments` (account
        # deletion) -- exercised end-to-end in
        # `bookings.tests.test_acceptance_journey
        # .AccountDeletionCancelsUpcomingAppointmentsTests`. This is the
        # direct, seam-level proof that the kwarg itself does what it
        # says on a booking that would otherwise be rejected.
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=1)
        )

        transition(booking, Booking.Status.CANCELLED, actor=self.patient, enforce_notice=False)

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)

    def test_enforce_notice_true_is_the_default(self):
        booking = self._booking(
            status=Booking.Status.CONFIRMED, start_time=timezone.now() + timedelta(hours=1)
        )

        with self.assertRaises(CancellationNoticeTooShort):
            transition(booking, Booking.Status.CANCELLED, actor=self.patient)


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
