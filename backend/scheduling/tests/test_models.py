from datetime import date, datetime
from datetime import timezone as dt_timezone

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from scheduling.models import AppointmentType, Availability, BlockedTime

from .helpers import SchedulingAPITestCase


class AvailabilityModelTests(SchedulingAPITestCase):
    def test_clean_rejects_a_non_provider(self):
        patient = self.create_patient()
        availability = Availability(
            provider=patient, day_of_week=0, start_time="09:00", end_time="17:00"
        )

        with self.assertRaises(ValidationError):
            availability.clean()

    def test_clean_accepts_a_provider(self):
        provider = self.create_provider()
        availability = Availability(
            provider=provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )

        availability.clean()  # does not raise

    def test_clean_rejects_end_time_before_start_time(self):
        provider = self.create_provider()
        availability = Availability(
            provider=provider, day_of_week=0, start_time="17:00", end_time="09:00"
        )

        with self.assertRaises(ValidationError):
            availability.clean()

    def test_db_check_constraint_rejects_end_before_start(self):
        provider = self.create_provider()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Availability.objects.create(
                    provider=provider, day_of_week=0, start_time="17:00", end_time="09:00"
                )

    def test_effective_from_defaults_to_null(self):
        provider = self.create_provider()

        availability = Availability.objects.create(
            provider=provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )

        self.assertIsNone(availability.effective_from)

    def test_ordering_puts_baseline_rows_first_then_generations_by_date(self):
        provider = self.create_provider()
        later_generation = Availability.objects.create(
            provider=provider,
            day_of_week=0,
            start_time="09:00",
            end_time="17:00",
            effective_from=date(2026, 10, 1),
        )
        earlier_generation = Availability.objects.create(
            provider=provider,
            day_of_week=0,
            start_time="09:00",
            end_time="17:00",
            effective_from=date(2026, 9, 1),
        )
        baseline = Availability.objects.create(
            provider=provider, day_of_week=6, start_time="09:00", end_time="17:00"
        )

        self.assertEqual(
            list(Availability.objects.all()),
            [baseline, earlier_generation, later_generation],
        )

    def test_ordering_within_a_generation_is_by_day_then_start_time(self):
        provider = self.create_provider()
        monday_late = Availability.objects.create(
            provider=provider, day_of_week=0, start_time="13:00", end_time="17:00"
        )
        tuesday = Availability.objects.create(
            provider=provider, day_of_week=1, start_time="09:00", end_time="17:00"
        )
        monday_early = Availability.objects.create(
            provider=provider, day_of_week=0, start_time="09:00", end_time="12:00"
        )

        self.assertEqual(
            list(Availability.objects.all()),
            [monday_early, monday_late, tuesday],
        )


class AppointmentTypeModelTests(SchedulingAPITestCase):
    def test_clean_rejects_a_non_provider(self):
        patient = self.create_patient()
        appointment_type = AppointmentType(provider=patient, name="Follow-up")

        with self.assertRaises(ValidationError):
            appointment_type.clean()

    def test_clean_accepts_a_provider(self):
        provider = self.create_provider()
        appointment_type = AppointmentType(provider=provider, name="Follow-up")

        appointment_type.clean()  # does not raise

    def test_duplicate_name_for_same_provider_is_rejected_at_the_db_layer(self):
        provider = self.create_provider()
        AppointmentType.objects.create(provider=provider, name="Follow-up")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AppointmentType.objects.create(provider=provider, name="Follow-up")

    def test_same_name_is_allowed_for_different_providers(self):
        provider_a = self.create_provider(email="a@example.com")
        provider_b = self.create_provider(email="b@example.com")
        AppointmentType.objects.create(provider=provider_a, name="Follow-up")

        AppointmentType.objects.create(provider=provider_b, name="Follow-up")

        self.assertEqual(AppointmentType.objects.filter(name="Follow-up").count(), 2)

    def test_duration_defaults_to_60(self):
        provider = self.create_provider()

        appointment_type = AppointmentType.objects.create(provider=provider, name="Follow-up")

        self.assertEqual(appointment_type.duration_minutes, 60)

    def test_db_check_constraint_rejects_any_duration_other_than_60(self):
        # The fixed-60-minute rule is a real DB CheckConstraint (unlike the
        # provider-role rule, which is application-layer only) -- even code
        # that bypasses the serializer can't persist a non-60 duration.
        provider = self.create_provider()

        for bad_duration in (15, 59, 61, 120):
            with self.assertRaises(IntegrityError, msg=f"duration={bad_duration}"):
                with transaction.atomic():
                    AppointmentType.objects.create(
                        provider=provider, name="Custom", duration_minutes=bad_duration
                    )


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class BlockedTimeModelTests(SchedulingAPITestCase):
    def test_clean_rejects_a_non_provider(self):
        patient = self.create_patient()
        blocked_time = BlockedTime(
            provider=patient, start=_utc(2026, 8, 20, 0, 0), end=_utc(2026, 8, 21, 0, 0)
        )

        with self.assertRaises(ValidationError):
            blocked_time.clean()

    def test_clean_accepts_a_provider(self):
        provider = self.create_provider()
        blocked_time = BlockedTime(
            provider=provider, start=_utc(2026, 8, 20, 0, 0), end=_utc(2026, 8, 21, 0, 0)
        )

        blocked_time.clean()  # does not raise

    def test_clean_rejects_end_before_start(self):
        provider = self.create_provider()
        blocked_time = BlockedTime(
            provider=provider, start=_utc(2026, 8, 21, 0, 0), end=_utc(2026, 8, 20, 0, 0)
        )

        with self.assertRaises(ValidationError):
            blocked_time.clean()

    def test_db_check_constraint_rejects_end_before_start(self):
        provider = self.create_provider()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                BlockedTime.objects.create(
                    provider=provider, start=_utc(2026, 8, 21, 0, 0), end=_utc(2026, 8, 20, 0, 0)
                )

    def test_label_is_optional(self):
        provider = self.create_provider()

        blocked_time = BlockedTime.objects.create(
            provider=provider, start=_utc(2026, 8, 20, 0, 0), end=_utc(2026, 8, 21, 0, 0)
        )

        self.assertEqual(blocked_time.label, "")
