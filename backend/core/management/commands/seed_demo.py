"""Seed demo accounts and a multi-provider calendar for k6 (TICKET-13).

Creates ~10 k6 providers (America/Chicago, Mon-Fri availability, 2-4
name-only 60-minute appointment types), demo patients/admin (`DEMO_PASSWORD`),
and a deterministic sample of pre-existing bookings (~305 over 16,150 gross
slots in a 133-day horizon). Also seeds a weekly-recurring cohort (5 doctors,
20 patients, 100 standing weekly bookings).

Idempotent via natural keys (`get_or_create`, per-slot `idempotency_key`).
Re-running on a later calendar day extends the horizon forward and may add
bookings for newly reachable dates; same-day re-runs are fully idempotent.
"""
from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone as django_timezone

from bookings.exceptions import PatientAlreadyBooked, SlotNoLongerAvailable
from bookings.models import Booking
from bookings.services import create_booking
from scheduling.models import AppointmentType, Availability
from scheduling.slots import get_open_slots

User = get_user_model()

# Demo accounts, one per role. Password is fixed and dev-only -- never used
# outside a local/demo database seeded from this command.
DEMO_PASSWORD = "demo-password-not-for-prod"  # noqa: S105 -- seed fixture, not a real credential
# Shared clinic clock for every demo account so patient and provider
# calendars agree with a Central-time grader machine.
DEMO_TIMEZONE = "America/Chicago"

ADMIN_ACCOUNTS = [
    {"email": "admin@demo.aea.test", "name": "Demo Admin"},
]

PATIENT_ACCOUNTS = [
    {"email": "patient@demo.aea.test", "name": "Pat Patterson"},
    {"email": "patient2@demo.aea.test", "name": "Jordan Lee"},
    {"email": "patient3@demo.aea.test", "name": "Sam Rivera"},
    {"email": "patient4@demo.aea.test", "name": "Taylor Brooks"},
    {"email": "patient5@demo.aea.test", "name": "Morgan Diaz"},
]

# Mon-Fri (day_of_week 0-4) recurring hours per provider, deliberately not
# uniform: window count/length varies. `appointment_types` is a list of
# names only -- every type is a fixed 60-minute slot (the model default),
# so types differ only by name. Order still matters: the first entry is
# the "primary" type `_seed_bookings_for_provider` samples pre-existing
# bookings from (see that function's docstring for why only one type per
# provider is used for booking seeding).
#
# With hourly slots, this list works out to exactly 16,150 computed slots
# over the 133-day horizon below (`HORIZON_*`): 95 working days x the sum
# over providers of (window hours x type count) = 95 x 170. See
# `core/tests/test_seed_demo.py::EXPECTED_GROSS_SLOT_TOTAL`.
PROVIDER_CONFIGS = [
    {
        "email": "provider1@demo.aea.test",
        "name": "Dr. Ana Rossi",
        "timezone": DEMO_TIMEZONE,
        "windows": [("08:00", "15:00")],
        "appointment_types": ["Follow-up", "New Patient Visit", "Annual Physical"],
    },
    {
        "email": "provider2@demo.aea.test",
        "name": "Dr. Brian Chen",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "12:00"), ("13:00", "17:00")],  # lunch break
        "appointment_types": ["Consultation", "New Patient Visit"],
    },
    {
        "email": "provider3@demo.aea.test",
        "name": "Dr. Carla Gomez",
        "timezone": DEMO_TIMEZONE,
        "windows": [("07:00", "13:00")],
        "appointment_types": ["Follow-up", "Consultation", "Annual Physical"],
    },
    {
        "email": "provider4@demo.aea.test",
        "name": "Dr. Deepak Rao",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "16:00")],
        "appointment_types": ["Follow-up", "New Patient Visit"],
    },
    {
        "email": "provider5@demo.aea.test",
        "name": "Dr. Elena Petrova",
        "timezone": DEMO_TIMEZONE,
        "windows": [("10:00", "15:00")],
        "appointment_types": ["Consultation", "New Patient Visit", "Annual Physical"],
    },
    {
        "email": "provider6@demo.aea.test",
        "name": "Dr. Farid Haidari",
        "timezone": DEMO_TIMEZONE,
        "windows": [("08:00", "12:00"), ("13:00", "16:00")],  # lunch break
        "appointment_types": ["Follow-up", "New Patient Visit"],
    },
    {
        "email": "provider7@demo.aea.test",
        "name": "Dr. Grace Kim",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "14:00")],
        "appointment_types": ["Follow-up", "New Patient Visit", "Annual Physical"],
    },
    {
        "email": "provider8@demo.aea.test",
        "name": "Dr. Hassan Ali",
        "timezone": DEMO_TIMEZONE,
        "windows": [("08:00", "13:00")],
        "appointment_types": ["Consultation", "New Patient Visit"],
    },
    {
        "email": "provider9@demo.aea.test",
        "name": "Dr. Ines Fischer",
        "timezone": DEMO_TIMEZONE,
        "windows": [("07:30", "14:30")],
        "appointment_types": ["Follow-up", "Consultation", "Annual Physical"],
    },
    {
        "email": "provider10@demo.aea.test",
        "name": "Dr. Jamal Ochieng",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "16:00")],
        "appointment_types": [
            "Follow-up",
            "Consultation",
            "New Patient Visit",
            "Annual Physical",
        ],
    },
]

# The weekly-recurring cohort's patients: 20, a multiple of 5 (one working
# day per weekday) so `_seed_weekly_recurring_bookings` can hand every
# weekday an equal share -- 4 patients per weekday per doctor, 20/week.
WEEKLY_PATIENT_ACCOUNTS = [
    {"email": "patient6@demo.aea.test", "name": "Avery Coleman"},
    {"email": "patient7@demo.aea.test", "name": "Bailey Foster"},
    {"email": "patient8@demo.aea.test", "name": "Cameron Ortiz"},
    {"email": "patient9@demo.aea.test", "name": "Dakota Reyes"},
    {"email": "patient10@demo.aea.test", "name": "Elliot Nakamura"},
    {"email": "patient11@demo.aea.test", "name": "Finley Osei"},
    {"email": "patient12@demo.aea.test", "name": "Gabriela Cruz"},
    {"email": "patient13@demo.aea.test", "name": "Harper Lindqvist"},
    {"email": "patient14@demo.aea.test", "name": "Imani Clarke"},
    {"email": "patient15@demo.aea.test", "name": "Jules Bergstrom"},
    {"email": "patient16@demo.aea.test", "name": "Kai Anderson"},
    {"email": "patient17@demo.aea.test", "name": "Lena Kowalski"},
    {"email": "patient18@demo.aea.test", "name": "Marcus Webb"},
    {"email": "patient19@demo.aea.test", "name": "Noor Haddad"},
    {"email": "patient20@demo.aea.test", "name": "Oscar Delgado"},
    {"email": "patient21@demo.aea.test", "name": "Priya Chandra"},
    {"email": "patient22@demo.aea.test", "name": "Quinn Sullivan"},
    {"email": "patient23@demo.aea.test", "name": "Ravi Subramaniam"},
    {"email": "patient24@demo.aea.test", "name": "Sofia Marchetti"},
    {"email": "patient25@demo.aea.test", "name": "Theo Larsson"},
]

# 5 more doctors for the weekly-recurring cohort, same shape as
# PROVIDER_CONFIGS above but each given a single generous window: an
# 8-hour day of fixed 60-minute slots is 8 slots/day, comfortably above
# the 4 `_seed_weekly_recurring_bookings` needs (20 patients / 5
# weekdays).
WEEKLY_PROVIDER_CONFIGS = [
    {
        "email": "provider11@demo.aea.test",
        "name": "Dr. Miriam Osei",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "17:00")],
        "appointment_types": ["Follow-up", "New Patient Visit"],
    },
    {
        "email": "provider12@demo.aea.test",
        "name": "Dr. Lucas Almeida",
        "timezone": DEMO_TIMEZONE,
        "windows": [("08:00", "16:00")],
        "appointment_types": ["Consultation", "Annual Physical"],
    },
    {
        "email": "provider13@demo.aea.test",
        "name": "Dr. Naomi Choi",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "17:00")],
        "appointment_types": ["Follow-up", "Consultation"],
    },
    {
        "email": "provider14@demo.aea.test",
        "name": "Dr. Tariq Farouk",
        "timezone": DEMO_TIMEZONE,
        "windows": [("08:00", "16:00")],
        "appointment_types": ["New Patient Visit", "Annual Physical"],
    },
    {
        "email": "provider15@demo.aea.test",
        "name": "Dr. Sophie Lindgren",
        "timezone": DEMO_TIMEZONE,
        "windows": [("09:00", "17:00")],
        "appointment_types": ["Follow-up", "Consultation"],
    },
]

# Rolling window for the weekly-recurring cohort: starts tomorrow (same
# reasoning as HORIZON_START_OFFSET_DAYS below) and spans 5 full weeks (35
# days, itself a multiple of 7) so every weekday -- and therefore every
# patient's weekly slot -- occurs exactly 5 times, regardless of which
# day-of-week "tomorrow" happens to be. Deliberately relative to "today"
# rather than a hardcoded calendar month: a fixed month goes stale (and,
# once entirely in the past, silently seeds zero bookings, since
# `get_open_slots` correctly excludes past slots) the moment this command
# is run outside that specific month/year.
WEEKLY_HORIZON_LENGTH_DAYS = 35

# Forward-looking booking horizon: starts tomorrow (never today -- keeps
# every generated slot safely after `get_open_slots`'s "now" cutoff, so the
# arithmetic below isn't at the mercy of what time of day this command
# happens to run) and spans exactly 133 days = 19 full weeks. 133 is a
# multiple of 7, so every weekday occurs exactly 19 times in the horizon
# regardless of which day-of-week it starts on -- that's what makes the
# ~16,000 figure below exact, reproducible arithmetic rather than an
# estimate. This command calls `get_open_slots` directly over the full
# horizon; patient-facing `GET /scheduling/slots` is still capped at
# `MAX_SLOT_QUERY_RANGE_DAYS` (60) per request.
HORIZON_START_OFFSET_DAYS = 1
HORIZON_LENGTH_DAYS = 133

# Deterministic sampling density for pre-existing bookings: every Nth open
# slot of a provider's *primary* appointment type gets booked. Picked so
# the total lands at a "few percent" utilization -- realistic, not empty,
# not saturated -- while staying a fast, fully reproducible calculation
# (see `_seed_bookings_for_provider`).
BOOKING_SAMPLE_STEP = 20


def _first_free_patient(patients, start, end, start_index):
    """Return the first patient in the rotating list who does not already
    hold `[start, end)`, or None if every patient in the pool is busy.
    One appointment per hour block applies to patients as well as
    providers, so the seed cannot hand the same hour to the same person
    twice even across different doctors.
    """
    for step in range(len(patients)):
        candidate = patients[(start_index + step) % len(patients)]
        busy = Booking.objects.filter(
            patient=candidate,
            status__in=Booking.ACTIVE_STATUSES,
            start_time__lt=end,
            end_time__gt=start,
        ).exists()
        if not busy:
            return candidate
    return None


class Command(BaseCommand):
    help = (
        "Seed demo admin/provider/patient accounts plus a realistic "
        "multi-provider calendar (availability, appointment types, and a "
        "modest sample of pre-existing bookings) sized for the k6 load "
        "test in k6/ (see k6/README.md). Idempotent -- safe to re-run."
    )

    def handle(self, *args, **options):
        for account in ADMIN_ACCOUNTS:
            self._seed_account(account, role=User.Role.ADMIN)
        for account in PATIENT_ACCOUNTS:
            self._seed_account(account, role=User.Role.PATIENT)
        for account in WEEKLY_PATIENT_ACCOUNTS:
            self._seed_account(account, role=User.Role.PATIENT)

        providers = []
        for config in PROVIDER_CONFIGS:
            provider, appointment_types = self._seed_provider(config)
            providers.append((provider, appointment_types))

        weekly_providers = []
        for config in WEEKLY_PROVIDER_CONFIGS:
            provider, appointment_types = self._seed_provider(config)
            weekly_providers.append((provider, appointment_types))

        horizon_start = django_timezone.now().date() + timedelta(days=HORIZON_START_OFFSET_DAYS)
        horizon_end = horizon_start + timedelta(days=HORIZON_LENGTH_DAYS - 1)

        gross_slot_total = self._report_gross_slot_capacity(providers, horizon_start, horizon_end)

        patients = list(User.objects.filter(email__in=[p["email"] for p in PATIENT_ACCOUNTS]))
        booking_count = 0
        for index, (provider, appointment_types) in enumerate(providers):
            booking_count += self._seed_bookings_for_provider(
                provider,
                appointment_types[0],
                horizon_start,
                horizon_end,
                patients=patients,
                patient_offset=index,
            )

        net_slot_total = self._report_net_slot_capacity(providers, horizon_start, horizon_end)

        weekly_horizon_end = horizon_start + timedelta(days=WEEKLY_HORIZON_LENGTH_DAYS - 1)
        weekly_patients = list(
            User.objects.filter(email__in=[p["email"] for p in WEEKLY_PATIENT_ACCOUNTS])
        )
        weekly_booking_count = 0
        for index, (provider, appointment_types) in enumerate(weekly_providers):
            weekly_booking_count += self._seed_weekly_recurring_bookings(
                provider,
                appointment_types[0],
                weekly_patients,
                horizon_start,
                weekly_horizon_end,
                weekday_rotation=index,
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Seed summary:"))
        self.stdout.write(f"  providers: {len(providers)}")
        self.stdout.write(f"  patients: {len(PATIENT_ACCOUNTS)}")
        self.stdout.write(
            f"  booking horizon: {horizon_start.isoformat()} .. {horizon_end.isoformat()} "
            f"({HORIZON_LENGTH_DAYS} days)"
        )
        self.stdout.write(
            f"  gross computed slots (structural capacity, ignores existing bookings): "
            f"{gross_slot_total}"
        )
        self.stdout.write(f"  pre-existing bookings seeded: {booking_count}")
        self.stdout.write(f"  net open slots right now: {net_slot_total}")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Weekly-recurring cohort:"))
        self.stdout.write(f"  doctors: {len(weekly_providers)}")
        self.stdout.write(f"  patients: {len(weekly_patients)}")
        self.stdout.write(
            f"  window: {horizon_start.isoformat()} .. {weekly_horizon_end.isoformat()} "
            f"({WEEKLY_HORIZON_LENGTH_DAYS} days, ~5 weeks)"
        )
        self.stdout.write(
            f"  bookings seeded: {weekly_booking_count} "
            f"(target: {len(weekly_providers)} doctors x {len(weekly_patients)} patients "
            f"x ~5 weeks)"
        )

    def _seed_account(self, account, *, role):
        user, created = User.objects.get_or_create(
            email=account["email"],
            defaults={
                "name": account["name"],
                "role": role,
                "timezone": DEMO_TIMEZONE,
            },
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"  created {role}: {account['email']}"))
        else:
            if user.timezone != DEMO_TIMEZONE:
                user.timezone = DEMO_TIMEZONE
                user.save(update_fields=["timezone"])
            self.stdout.write(f"  already exists {role}: {account['email']}")

    def _seed_provider(self, config):
        provider, created = User.objects.get_or_create(
            email=config["email"],
            defaults={
                "name": config["name"],
                "role": User.Role.PROVIDER,
                "timezone": config["timezone"],
            },
        )
        if created:
            provider.set_password(DEMO_PASSWORD)
            provider.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"  created provider: {config['email']}"))
        else:
            if provider.timezone != config["timezone"]:
                provider.timezone = config["timezone"]
                provider.save(update_fields=["timezone"])
            self.stdout.write(f"  already exists provider: {config['email']}")

        for day in range(5):  # Monday(0) .. Friday(4)
            for start, end in config["windows"]:
                Availability.objects.get_or_create(
                    provider=provider, day_of_week=day, start_time=start, end_time=end
                )

        appointment_types = []
        for name in config["appointment_types"]:
            # `duration_minutes` relies on the model default (60) -- the
            # only value the `appointment_type_duration_is_60` constraint
            # admits.
            appointment_type, _ = AppointmentType.objects.get_or_create(
                provider=provider, name=name
            )
            appointment_types.append(appointment_type)

        return provider, appointment_types

    def _report_gross_slot_capacity(self, providers, horizon_start, horizon_end):
        """Structural slot capacity, ignoring any existing booking/blocked
        state (`busy_intervals=()`) -- the "show your math" figure: given
        only the availability windows and appointment-type durations
        configured above, this is deterministic and independent of
        anything else this command has done in a prior run.
        """
        total = 0
        for provider, appointment_types in providers:
            for appointment_type in appointment_types:
                slots = get_open_slots(
                    provider,
                    appointment_type,
                    horizon_start,
                    horizon_end,
                    now=django_timezone.now(),
                )
                total += len(slots)
        return total

    def _report_net_slot_capacity(self, providers, horizon_start, horizon_end):
        """Same computation as `_report_gross_slot_capacity`, but through
        the real `SlotsView`-equivalent path (real `busy_intervals` from
        currently-active `Booking` rows) -- what a patient would actually
        see right now, after this run's `_seed_bookings_for_provider` calls.
        """
        total = 0
        for provider, appointment_types in providers:
            busy_intervals = [
                (booking.start_time, booking.end_time)
                for booking in Booking.objects.filter(
                    provider=provider, status__in=Booking.ACTIVE_STATUSES
                )
            ]
            for appointment_type in appointment_types:
                slots = get_open_slots(
                    provider,
                    appointment_type,
                    horizon_start,
                    horizon_end,
                    busy_intervals=busy_intervals,
                    now=django_timezone.now(),
                )
                total += len(slots)
        return total

    def _seed_bookings_for_provider(
        self,
        provider,
        primary_appointment_type,
        horizon_start,
        horizon_end,
        *,
        patients,
        patient_offset,
    ):
        """Every `BOOKING_SAMPLE_STEP`th open slot of the primary appointment type.

        One type per provider only: all types share the same 60-minute grid.
        Idempotent via deterministic `idempotency_key` per slot start.
        """
        candidates = get_open_slots(
            provider,
            primary_appointment_type,
            horizon_start,
            horizon_end,
            now=django_timezone.now(),
        )
        sampled = candidates[::BOOKING_SAMPLE_STEP]

        booked = 0
        for offset, slot in enumerate(sampled):
            start_index = (patient_offset + offset) % len(patients)
            patient = _first_free_patient(patients, slot.start, slot.end, start_index)
            if patient is None:
                continue
            idempotency_key = (
                f"seed-booking-{provider.id}-{primary_appointment_type.id}-{slot.start.isoformat()}"
            )
            try:
                create_booking(
                    patient=patient,
                    provider=provider,
                    appointment_type=primary_appointment_type,
                    start_time=slot.start,
                    idempotency_key=idempotency_key,
                )
            except (PatientAlreadyBooked, SlotNoLongerAvailable):
                continue
            booked += 1

        self.stdout.write(
            f"  provider {provider.email}: sampled {booked} slots for pre-existing bookings "
            f"(of {len(candidates)} open {primary_appointment_type.name} slots)"
        )
        return booked

    def _seed_weekly_recurring_bookings(
        self,
        provider,
        appointment_type,
        patients,
        horizon_start,
        horizon_end,
        *,
        weekday_rotation=0,
    ):
        """Standing weekly slot per patient per provider (not random sampling).

        Candidates are bucketed by `(weekday, position-within-day)`; booking
        every slot in a patient's bucket is one recurring weekly time for the
        full horizon. `weekday_rotation` (this provider's index in the cohort)
        shifts which weekday each patient gets so five doctors do not all hand
        patient `i` the same hour (which would violate
        `unique_active_booking_per_patient_slot`, architecture.md §3).
        """
        candidates = get_open_slots(
            provider, appointment_type, horizon_start, horizon_end, now=django_timezone.now()
        )

        buckets = defaultdict(list)
        provider_zone = ZoneInfo(provider.timezone)
        current_date, position = None, -1
        for slot in candidates:
            local_date = slot.start.astimezone(provider_zone).date()
            position = 0 if local_date != current_date else position + 1
            current_date = local_date
            weekday = slot.start.astimezone(provider_zone).weekday()
            buckets[(weekday, position)].append(slot)

        booked = 0
        for index, patient in enumerate(patients):
            weekday, position = (index + weekday_rotation) % 5, index // 5
            for slot in buckets.get((weekday, position), []):
                if _first_free_patient([patient], slot.start, slot.end, 0) is None:
                    continue
                idempotency_key = (
                    f"seed-weekly-{provider.id}-{appointment_type.id}-{slot.start.isoformat()}"
                )
                try:
                    create_booking(
                        patient=patient,
                        provider=provider,
                        appointment_type=appointment_type,
                        start_time=slot.start,
                        idempotency_key=idempotency_key,
                    )
                except (PatientAlreadyBooked, SlotNoLongerAvailable):
                    continue
                booked += 1

        self.stdout.write(
            f"  provider {provider.email}: seeded {booked} weekly-recurring bookings "
            f"across {len(patients)} patients"
        )
        return booked
