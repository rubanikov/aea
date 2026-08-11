from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone as django_timezone

from bookings.models import Booking
from core.management.commands.seed_demo import (
    HORIZON_LENGTH_DAYS,
    HORIZON_START_OFFSET_DAYS,
    PROVIDER_CONFIGS,
)
from scheduling.models import AppointmentType, Availability
from scheduling.slots import get_open_slots

User = get_user_model()

# Independently worked out from `PROVIDER_CONFIGS`' windows/durations and the
# 56-day (8-full-week) horizon -- see this ticket's handoff notes for the
# per-provider arithmetic. Not derived by calling the code under test, so
# this is a real assertion, not a tautology: if `seed_demo`'s config ever
# drifts from this number, this test is what catches it.
EXPECTED_GROSS_SLOT_TOTAL = 15960
EXPECTED_AVAILABILITY_ROW_COUNT = 60  # 12 windows across 10 providers x 5 weekdays
EXPECTED_APPOINTMENT_TYPE_COUNT = 27  # sum of len(appointment_types) per provider
EXPECTED_BOOKING_COUNT = 442  # sum of floor(primary_type_slots / BOOKING_SAMPLE_STEP)


class SeedDemoCommandTests(TestCase):
    """Seeding a full ~16,000-slot dataset (10 providers, ~450 pre-existing
    bookings) is the slowest thing this command does, so it's run once in
    `setUpTestData` -- Django's per-class fixture, wrapped in its own
    transaction and rolled back to a savepoint between test methods -- and
    every read-only assertion below shares that one run. Only
    `test_is_idempotent` calls the command again, on top of that shared
    data, since re-invoking it is the exact behavior under test there.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", stdout=StringIO())

    def setUp(self):
        # The login rate throttle's counters live in the shared default
        # cache, which persists across test modules within a single test
        # run — see accounts/tests/test_throttle.py.
        cache.clear()

    def test_lists_the_demo_accounts_it_created_or_found(self):
        out = StringIO()

        call_command("seed_demo", stdout=out)

        output = out.getvalue()
        self.assertIn("admin", output)
        self.assertIn("provider", output)
        self.assertIn("patient", output)

    def test_creates_one_admin_ten_providers_and_five_patients(self):
        self.assertEqual(User.objects.filter(role=User.Role.ADMIN).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PROVIDER).count(), 10)
        self.assertEqual(User.objects.filter(role=User.Role.PATIENT).count(), 5)

    def test_providers_have_distinct_timezones_and_2_to_4_appointment_types(self):
        providers = User.objects.filter(role=User.Role.PROVIDER)
        timezones = {provider.timezone for provider in providers}
        self.assertGreater(len(timezones), 1)  # "not perfectly uniform"

        for provider in providers:
            type_count = AppointmentType.objects.filter(provider=provider).count()
            self.assertGreaterEqual(type_count, 2)
            self.assertLessEqual(type_count, 4)

    def test_appointment_type_durations_are_in_the_realistic_10_to_60_minute_range(self):
        for duration in AppointmentType.objects.values_list("duration_minutes", flat=True):
            self.assertGreaterEqual(duration, 10)
            self.assertLessEqual(duration, 60)

    def test_creates_the_expected_number_of_availability_and_appointment_type_rows(self):
        self.assertEqual(Availability.objects.count(), EXPECTED_AVAILABILITY_ROW_COUNT)
        self.assertEqual(AppointmentType.objects.count(), EXPECTED_APPOINTMENT_TYPE_COUNT)

    def test_gross_computed_slot_total_reaches_the_ticket_13_target(self):
        horizon_start = django_timezone.now().date() + timedelta(days=HORIZON_START_OFFSET_DAYS)
        horizon_end = horizon_start + timedelta(days=HORIZON_LENGTH_DAYS - 1)

        total = 0
        for config in PROVIDER_CONFIGS:
            provider = User.objects.get(email=config["email"])
            for appointment_type in AppointmentType.objects.filter(provider=provider):
                total += len(get_open_slots(provider, appointment_type, horizon_start, horizon_end))

        self.assertEqual(total, EXPECTED_GROSS_SLOT_TOTAL)

    def test_seeds_a_modest_realistic_utilization_of_pre_existing_bookings(self):
        booking_count = Booking.objects.count()
        self.assertEqual(booking_count, EXPECTED_BOOKING_COUNT)
        # "Not empty and not saturated" -- a few percent of the gross slot
        # total, nowhere near it.
        utilization = booking_count / EXPECTED_GROSS_SLOT_TOTAL
        self.assertGreater(utilization, 0.01)
        self.assertLess(utilization, 0.10)

        self.assertTrue(
            Booking.objects.filter(status__in=Booking.ACTIVE_STATUSES).exists(),
        )

    def test_is_idempotent(self):
        call_command("seed_demo", stdout=StringIO())

        self.assertEqual(User.objects.count(), 16)
        self.assertEqual(Availability.objects.count(), EXPECTED_AVAILABILITY_ROW_COUNT)
        self.assertEqual(AppointmentType.objects.count(), EXPECTED_APPOINTMENT_TYPE_COUNT)
        self.assertEqual(Booking.objects.count(), EXPECTED_BOOKING_COUNT)

    def test_demo_accounts_can_log_in_with_the_seeded_password(self):
        from accounts.tests.helpers import AJAX_HEADERS

        response = self.client.post(
            "/auth/login",
            {"email": "patient@demo.aea.test", "password": "demo-password-not-for-prod"},
            content_type="application/json",
            **AJAX_HEADERS,
        )

        self.assertEqual(response.status_code, 200)
