from django.test import TestCase

# Every unsafe-method request this API accepts requires this header (see
# accounts/csrf.py) -- tests exercise the API the same way a real browser
# client has to, header included, rather than special-casing it away.
AJAX_HEADERS = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}

# Fixture value only -- satisfies AUTH_PASSWORD_VALIDATORS, never a real
# credential. Kept as a module constant (not a function default argument)
# so it reads unambiguously as test fixture data.
TEST_PASSWORD = "a-strong-unique-passphrase-42"


class AuthAPITestCase(TestCase):
    """Base class for tests that talk to the JSON API over HTTP (the seam
    these tests exercise throughout -- matching the existing precedent in
    core/tests/test_health.py)."""

    def post_json(self, path, data=None, **extra):
        return self.client.post(
            path, data or {}, content_type="application/json", **AJAX_HEADERS, **extra
        )

    def patch_json(self, path, data=None, **extra):
        return self.client.patch(
            path, data or {}, content_type="application/json", **AJAX_HEADERS, **extra
        )

    def register(self, **overrides):
        payload = {
            "email": "patient@example.com",
            "password": TEST_PASSWORD,
            "name": "Pat Patient",
            **overrides,
        }
        return self.post_json("/auth/register", payload)

    def login(self, email="patient@example.com", password=None):
        return self.post_json(
            "/auth/login", {"email": email, "password": password or TEST_PASSWORD}
        )
