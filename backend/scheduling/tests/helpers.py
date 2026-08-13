from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone as django_timezone

from accounts.tests.helpers import AJAX_HEADERS, TEST_PASSWORD
from bookings.models import Booking

User = get_user_model()

__all__ = ["AJAX_HEADERS", "TEST_PASSWORD", "SchedulingAPITestCase", "next_monday"]


def next_monday(*, min_days_ahead=7):
    """The first Monday at least `min_days_ahead` days from the real
    current date -- far enough out that "tomorrow" never lands past it,
    near enough that the 90-day collision horizon always includes it.
    Derived from the real clock because the schedule/slots views resolve
    "today" from `django_timezone.now()` (never mocked in API tests --
    the cookie-JWT auth path shares that module)."""
    day = django_timezone.now().date() + timedelta(days=min_days_ahead)
    while day.weekday() != 0:  # Monday
        day += timedelta(days=1)
    return day


class SchedulingAPITestCase(TestCase):
    """API-seam test base for the scheduling app. Reuses the AJAX-header
    convention from `accounts/tests/helpers.py`'s `AuthAPITestCase` (every
    unsafe-method request here goes through the same
    `CookieJWTAuthentication` CSRF check) rather than duplicating it, and
    adds provider/patient creation + login helpers that module doesn't have
    (its own helpers only cover patient self-registration).
    """

    def post_json(self, path, data=None, **extra):
        return self.client.post(
            path, data or {}, content_type="application/json", **AJAX_HEADERS, **extra
        )

    def patch_json(self, path, data=None, **extra):
        return self.client.patch(
            path, data or {}, content_type="application/json", **AJAX_HEADERS, **extra
        )

    def put_json(self, path, data=None, **extra):
        return self.client.put(
            path, data or {}, content_type="application/json", **AJAX_HEADERS, **extra
        )

    def delete_json(self, path, **extra):
        return self.client.delete(path, **AJAX_HEADERS, **extra)

    def create_provider(
        self, email="provider@example.com", timezone="America/New_York", **overrides
    ):
        return User.objects.create_user(
            email=email,
            password=TEST_PASSWORD,
            role=User.Role.PROVIDER,
            timezone=timezone,
            **overrides,
        )

    def create_patient(self, email="patient@example.com", **overrides):
        return User.objects.create_user(
            email=email, password=TEST_PASSWORD, role=User.Role.PATIENT, **overrides
        )

    def create_booking(
        self,
        *,
        provider,
        appointment_type,
        start_time,
        patient=None,
        status=Booking.Status.CONFIRMED,
    ):
        """Creates a `Booking` row directly, bypassing
        `bookings.services.create_booking`. Collision tests only need an
        existing row of a given status/time to check against, not to exercise
        the booking-creation flow (that's `bookings/tests`' job). `end_time`
        is derived from `appointment_type.duration_minutes`, same as the real
        service does.
        """
        if patient is None:
            # Unique email per call, keyed off existing booking count — some
            # tests create multiple bookings and `create_patient`'s default
            # email is a fixed constant that would collide on the second call.
            patient = self.create_patient(
                email=f"patient-{Booking.objects.count()}@example.com"
            )
        return Booking.objects.create(
            provider=provider,
            patient=patient,
            appointment_type=appointment_type,
            start_time=start_time,
            end_time=start_time + timedelta(minutes=appointment_type.duration_minutes),
            status=status,
        )

    def login_as(self, user):
        # The login throttle's counters live in the default cache, which
        # Django's test runner does not reset between tests on its own (see
        # accounts/tests/test_throttle.py) -- cleared on every call here so
        # a test suite with many `login_as` calls never trips
        # DEFAULT_THROTTLE_RATES["login"] on unrelated tests.
        cache.clear()
        response = self.post_json(
            "/auth/login", {"email": user.email, "password": TEST_PASSWORD}
        )
        assert response.status_code == 200, response.content
        return response
