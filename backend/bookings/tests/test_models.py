from datetime import datetime
from datetime import timezone as dt_timezone

from django.db import IntegrityError, transaction

from bookings.models import Booking
from scheduling.models import AppointmentType

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class BookingConstraintTests(BookingsAPITestCase):
    """Layer 2 (architecture.md §3) exercised directly at the model layer,
    same style as `scheduling/tests/test_models.py`'s constraint tests --
    the concurrency-under-load version of this same guarantee lives in
    `bookings/tests/test_concurrency.py`.
    """

    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )

    def _create(self, *, status=Booking.Status.CONFIRMED, start=_utc(2026, 8, 17, 9, 0)):
        return Booking.objects.create(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=start,
            end_time=start.replace(hour=start.hour + 1),
            status=status,
        )

    def test_two_active_bookings_for_the_same_provider_and_start_time_are_rejected(self):
        self._create(status=Booking.Status.CONFIRMED)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._create(status=Booking.Status.REQUESTED)

    def test_a_cancelled_booking_does_not_block_the_same_slot(self):
        self._create(status=Booking.Status.CANCELLED)

        # Does not raise -- a cancelled booking isn't an "active" occupant
        # of the slot (Booking.ACTIVE_STATUSES).
        self._create(status=Booking.Status.CONFIRMED)

        self.assertEqual(Booking.objects.count(), 2)

    def test_same_provider_different_start_times_are_both_allowed(self):
        self._create(start=_utc(2026, 8, 17, 9, 0))

        self._create(start=_utc(2026, 8, 17, 10, 0))

        self.assertEqual(Booking.objects.count(), 2)

    def test_different_providers_can_share_the_same_start_time(self):
        other_provider = self.create_provider(email="other@example.com")
        self._create()

        Booking.objects.create(
            provider=other_provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
            end_time=_utc(2026, 8, 17, 10, 0),
            status=Booking.Status.CONFIRMED,
        )

        self.assertEqual(Booking.objects.count(), 2)

    def test_db_check_constraint_rejects_end_before_start(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Booking.objects.create(
                    provider=self.provider,
                    patient=self.patient,
                    appointment_type=self.appointment_type,
                    start_time=_utc(2026, 8, 17, 10, 0),
                    end_time=_utc(2026, 8, 17, 9, 0),
                    status=Booking.Status.CONFIRMED,
                )

    def test_idempotency_key_is_optional_and_multiple_nulls_are_allowed(self):
        self._create(start=_utc(2026, 8, 17, 9, 0))
        self._create(start=_utc(2026, 8, 17, 10, 0))

        self.assertEqual(Booking.objects.filter(idempotency_key__isnull=True).count(), 2)

    def test_idempotency_key_is_unique_when_set(self):
        Booking.objects.create(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
            end_time=_utc(2026, 8, 17, 10, 0),
            status=Booking.Status.CONFIRMED,
            idempotency_key="dup-key",
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Booking.objects.create(
                    provider=self.provider,
                    patient=self.patient,
                    appointment_type=self.appointment_type,
                    start_time=_utc(2026, 8, 17, 10, 0),
                    end_time=_utc(2026, 8, 17, 11, 0),
                    status=Booking.Status.CONFIRMED,
                    idempotency_key="dup-key",
                )
