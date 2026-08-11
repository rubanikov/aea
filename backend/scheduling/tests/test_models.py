from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from scheduling.models import AppointmentType, Availability

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


class AppointmentTypeModelTests(SchedulingAPITestCase):
    def test_clean_rejects_a_non_provider(self):
        patient = self.create_patient()
        appointment_type = AppointmentType(provider=patient, name="Follow-up", duration_minutes=15)

        with self.assertRaises(ValidationError):
            appointment_type.clean()

    def test_clean_accepts_a_provider(self):
        provider = self.create_provider()
        appointment_type = AppointmentType(
            provider=provider, name="Follow-up", duration_minutes=15
        )

        appointment_type.clean()  # does not raise

    def test_duplicate_name_for_same_provider_is_rejected_at_the_db_layer(self):
        provider = self.create_provider()
        AppointmentType.objects.create(provider=provider, name="Follow-up", duration_minutes=15)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                AppointmentType.objects.create(
                    provider=provider, name="Follow-up", duration_minutes=30
                )

    def test_same_name_is_allowed_for_different_providers(self):
        provider_a = self.create_provider(email="a@example.com")
        provider_b = self.create_provider(email="b@example.com")
        AppointmentType.objects.create(provider=provider_a, name="Follow-up", duration_minutes=15)

        AppointmentType.objects.create(provider=provider_b, name="Follow-up", duration_minutes=30)

        self.assertEqual(AppointmentType.objects.filter(name="Follow-up").count(), 2)
