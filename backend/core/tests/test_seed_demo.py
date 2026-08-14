from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone as django_timezone

from bookings.models import Booking
from core.management.commands.seed_demo import (
    BOOKING_SAMPLE_STEP,
    DEMO_TIMEZONE,
    HORIZON_LENGTH_DAYS,
    HORIZON_START_OFFSET_DAYS,
    PROVIDER_CONFIGS,
    WEEKLY_HORIZON_LENGTH_DAYS,
    WEEKLY_PATIENT_ACCOUNTS,
    WEEKLY_PROVIDER_CONFIGS,
)
from scheduling.models import AppointmentType, Availability
from scheduling.slots import MAX_SLOT_QUERY_RANGE_DAYS, get_open_slots

User = get_user_model()

# Independently worked out from `PROVIDER_CONFIGS`' windows and the 133-day
# (19-full-week) horizon, with every type a fixed 60-minute slot: 95 working
# days x sum over providers of (window hours x type count)
# = 95 x (7x3 + 7x2 + 6x3 + 7x2 + 5x3 + 7x2 + 5x3 + 5x2 + 7x3 + 7x4)
# = 95 x 170. Not derived by calling the code under test, so this is a real
# assertion, not a tautology: if `seed_demo`'s config ever drifts from this
# number, this test is what catches it.
EXPECTED_GROSS_SLOT_TOTAL = 16150
# 12 windows across the original 10 providers x 5 weekdays (60), plus the
# weekly cohort's 5 providers x 1 window each x 5 weekdays (25).
EXPECTED_AVAILABILITY_ROW_COUNT = 60 + 25
# sum of len(appointment_types) per provider: 27 for the original 10, plus
# 2 each for the weekly cohort's 5 (10).
EXPECTED_APPOINTMENT_TYPE_COUNT = 27 + 10
# Sum over providers of ceil(primary_type_slots / BOOKING_SAMPLE_STEP),
# where primary_type_slots = window hours x 95 working days (hourly slots):
# 665,665,570,665,475,665,475,475,665,665
# -> 34+34+29+34+24+34+24+24+34+34.
EXPECTED_BOOKING_COUNT = 305
# Per-provider sample counts from the brief (primary-type slots / BOOKING_SAMPLE_STEP).
EXPECTED_PER_PROVIDER_BOOKING_COUNTS = [34, 34, 29, 34, 24, 34, 24, 24, 34, 34]
# Every weekday in WEEKLY_HORIZON_LENGTH_DAYS occurs this many times --
# exact, not a sample, since 35 (5 weeks) is a multiple of 7.
EXPECTED_WEEKLY_OCCURRENCES_PER_PATIENT_PER_DOCTOR = WEEKLY_HORIZON_LENGTH_DAYS // 7
EXPECTED_WEEKLY_BOOKING_COUNT = (
    len(WEEKLY_PROVIDER_CONFIGS)
    * len(WEEKLY_PATIENT_ACCOUNTS)
    * EXPECTED_WEEKLY_OCCURRENCES_PER_PATIENT_PER_DOCTOR
)


class SeedDemoCommandTests(TestCase):
    """Heavy seed runs once in `setUpTestData`; only `test_is_idempotent` re-runs."""
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

    def test_horizon_and_sampling_constants_match_ticket_01_contract(self):
        self.assertEqual(HORIZON_LENGTH_DAYS, 133)
        self.assertEqual(WEEKLY_HORIZON_LENGTH_DAYS, 35)
        self.assertEqual(BOOKING_SAMPLE_STEP, 20)
        self.assertEqual(MAX_SLOT_QUERY_RANGE_DAYS, 60)

    def test_creates_one_admin_fifteen_providers_and_twenty_five_patients(self):
        self.assertEqual(User.objects.filter(role=User.Role.ADMIN).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PROVIDER).count(), 15)
        self.assertEqual(User.objects.filter(role=User.Role.PATIENT).count(), 25)

    def test_demo_accounts_use_central_timezone_and_providers_have_2_to_4_appointment_types(self):
        timezones = set(User.objects.values_list("timezone", flat=True))
        self.assertEqual(timezones, {DEMO_TIMEZONE})
        providers = User.objects.filter(role=User.Role.PROVIDER)

        for provider in providers:
            type_count = AppointmentType.objects.filter(provider=provider).count()
            self.assertGreaterEqual(type_count, 2)
            self.assertLessEqual(type_count, 4)

    def test_every_appointment_type_has_the_fixed_60_minute_duration(self):
        durations = set(AppointmentType.objects.values_list("duration_minutes", flat=True))
        self.assertEqual(durations, {60})

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

    def test_each_original_provider_has_the_brief_per_provider_booking_sample_count(self):
        original_provider_emails = [config["email"] for config in PROVIDER_CONFIGS]
        for email, expected_count in zip(
            original_provider_emails, EXPECTED_PER_PROVIDER_BOOKING_COUNTS, strict=True
        ):
            count = Booking.objects.filter(provider__email=email).count()
            self.assertEqual(
                count,
                expected_count,
                f"{email} expected {expected_count} sample bookings, got {count}",
            )

    def test_seeds_a_modest_realistic_utilization_of_pre_existing_bookings(self):
        # Scoped to the original 10 providers -- the weekly-recurring
        # cohort below is a deliberately different, fully-booked-by-design
        # pattern, not a "modest sample," so it doesn't belong in this
        # utilization check.
        original_provider_emails = [config["email"] for config in PROVIDER_CONFIGS]
        booking_count = Booking.objects.filter(
            provider__email__in=original_provider_emails
        ).count()
        self.assertEqual(booking_count, EXPECTED_BOOKING_COUNT)
        # "Not empty and not saturated" -- a few percent of the gross slot
        # total, nowhere near it.
        utilization = booking_count / EXPECTED_GROSS_SLOT_TOTAL
        self.assertGreater(utilization, 0.01)
        self.assertLess(utilization, 0.10)

        self.assertTrue(
            Booking.objects.filter(status__in=Booking.ACTIVE_STATUSES).exists(),
        )

    def test_weekly_cohort_gives_every_patient_one_slot_per_doctor_per_week(self):
        weekly_provider_emails = [config["email"] for config in WEEKLY_PROVIDER_CONFIGS]
        weekly_bookings = Booking.objects.filter(provider__email__in=weekly_provider_emails)

        self.assertEqual(weekly_bookings.count(), EXPECTED_WEEKLY_BOOKING_COUNT)

        # Every weekly-cohort patient sees every weekly-cohort doctor once a
        # week, for the whole window -- not sampled, not approximate.
        for patient_account in WEEKLY_PATIENT_ACCOUNTS:
            patient = User.objects.get(email=patient_account["email"])
            for provider_email in weekly_provider_emails:
                count = weekly_bookings.filter(
                    patient=patient, provider__email=provider_email
                ).count()
                self.assertEqual(
                    count,
                    EXPECTED_WEEKLY_OCCURRENCES_PER_PATIENT_PER_DOCTOR,
                    f"{patient.email} x {provider_email} expected "
                    f"{EXPECTED_WEEKLY_OCCURRENCES_PER_PATIENT_PER_DOCTOR}, got {count}",
                )

        # "Recurring weekly" means the same weekday and the same local
        # clock time every occurrence, exactly 7 days apart -- not just the
        # same count.
        sample_patient = User.objects.get(email=WEEKLY_PATIENT_ACCOUNTS[0]["email"])
        sample_provider_email = weekly_provider_emails[0]
        starts = list(
            weekly_bookings.filter(patient=sample_patient, provider__email=sample_provider_email)
            .order_by("start_time")
            .values_list("start_time", flat=True)
        )
        weekdays = {start.weekday() for start in starts}
        times_of_day = {start.time() for start in starts}
        self.assertEqual(weekdays, {starts[0].weekday()})
        self.assertEqual(times_of_day, {starts[0].time()})
        gaps = [(starts[i + 1] - starts[i]).days for i in range(len(starts) - 1)]
        self.assertTrue(all(gap == 7 for gap in gaps), gaps)

    def test_no_patient_holds_two_appointments_in_the_same_hour(self):
        for patient in User.objects.filter(role=User.Role.PATIENT):
            starts = list(
                Booking.objects.filter(
                    patient=patient,
                    status__in=Booking.ACTIVE_STATUSES,
                ).values_list("start_time", flat=True)
            )
            duplicates = sorted({start for start in starts if starts.count(start) > 1})
            self.assertEqual(
                duplicates,
                [],
                f"{patient.email} is booked twice at {duplicates}",
            )

    def test_is_idempotent(self):
        call_command("seed_demo", stdout=StringIO())

        self.assertEqual(User.objects.count(), 41)
        self.assertEqual(Availability.objects.count(), EXPECTED_AVAILABILITY_ROW_COUNT)
        self.assertEqual(AppointmentType.objects.count(), EXPECTED_APPOINTMENT_TYPE_COUNT)
        self.assertEqual(
            Booking.objects.count(), EXPECTED_BOOKING_COUNT + EXPECTED_WEEKLY_BOOKING_COUNT
        )

    def test_demo_accounts_can_log_in_with_the_seeded_password(self):
        from accounts.tests.helpers import AJAX_HEADERS

        response = self.client.post(
            "/auth/login",
            {"email": "patient@demo.aea.test", "password": "demo-password-not-for-prod"},
            content_type="application/json",
            **AJAX_HEADERS,
        )

        self.assertEqual(response.status_code, 200)
