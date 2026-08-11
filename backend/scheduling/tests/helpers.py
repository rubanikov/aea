from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from accounts.tests.helpers import AJAX_HEADERS, TEST_PASSWORD

User = get_user_model()

__all__ = ["AJAX_HEADERS", "TEST_PASSWORD", "SchedulingAPITestCase"]


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
