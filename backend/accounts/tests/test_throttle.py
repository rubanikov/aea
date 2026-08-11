from django.core.cache import cache

from .helpers import AuthAPITestCase


class LoginThrottleTests(AuthAPITestCase):
    def setUp(self):
        # The throttle's counters live in the default cache, which Django's
        # test runner does not reset between tests on its own.
        cache.clear()
        self.register()
        # `AnonRateThrottle` only throttles *unauthenticated* requests, and
        # registering above logged this client in via cookie -- drop it so
        # the login attempts below are genuinely anonymous.
        self.client.cookies.clear()

    def test_nth_rapid_failed_login_attempt_is_throttled(self):
        # settings.py: DEFAULT_THROTTLE_RATES["login"] = "5/min"
        for _ in range(5):
            response = self.login(password="wrong-password")
            self.assertEqual(response.status_code, 400)

        throttled_response = self.login(password="wrong-password")

        self.assertEqual(throttled_response.status_code, 429)

    def test_throttle_is_scoped_to_login_and_does_not_block_registration(self):
        for _ in range(5):
            self.login(password="wrong-password")
        self.login(password="wrong-password")  # 6th -- throttled

        response = self.register(email="someone-else@example.com")

        self.assertEqual(response.status_code, 201)
