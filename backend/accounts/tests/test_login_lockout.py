"""Per-account login lockout (accounts/lockout.py).

Every failed attempt below arrives from a *different* REMOTE_ADDR --
modelling the IP-rotating brute force the per-IP LoginRateThrottle (5/min,
see test_throttle.py) can't stop, which is exactly the gap the lockout
closes. It also keeps these tests out of that throttle's way without
touching its configuration.
"""

from django.core.cache import cache

from accounts.lockout import LOCKOUT_DETAIL, LOCKOUT_MAX_FAILURES

from .helpers import TEST_PASSWORD, AuthAPITestCase


class LoginLockoutTests(AuthAPITestCase):
    def setUp(self):
        # Throttle and lockout counters both live in the default cache,
        # which the test runner does not reset between tests on its own.
        cache.clear()
        self.register()
        self.client.cookies.clear()

    def attempt_login(self, *, email="patient@example.com", password, attempt=0):
        """One login attempt from a distinct source address per `attempt`."""
        return self.post_json(
            "/auth/login",
            {"email": email, "password": password},
            REMOTE_ADDR=f"10.0.{attempt // 200}.{attempt % 200 + 1}",
        )

    def fail_repeatedly(self, count, email="patient@example.com"):
        for attempt in range(count):
            response = self.attempt_login(
                email=email, password="wrong-password", attempt=attempt
            )
        return response

    def test_lockout_triggers_after_max_failures_and_rejects_correct_password(self):
        with self.assertLogs("accounts.lockout", level="WARNING") as logs:
            last_failure = self.fail_repeatedly(LOCKOUT_MAX_FAILURES)

        # Failures themselves stay ordinary 400s -- the lockout only gates
        # *subsequent* attempts.
        self.assertEqual(last_failure.status_code, 400)
        self.assertIn("lockout engaged", logs.output[0])
        # No PHI in logs: the fingerprint, never the raw email.
        self.assertNotIn("patient@example.com", "".join(logs.output))

        locked_out = self.attempt_login(password=TEST_PASSWORD, attempt=500)

        self.assertEqual(locked_out.status_code, 429)
        self.assertEqual(locked_out.json(), {"detail": LOCKOUT_DETAIL})

    def test_correct_password_still_works_below_the_threshold(self):
        self.fail_repeatedly(LOCKOUT_MAX_FAILURES - 1)

        response = self.attempt_login(password=TEST_PASSWORD, attempt=500)

        self.assertEqual(response.status_code, 200)

    def test_successful_login_resets_the_counter(self):
        self.fail_repeatedly(LOCKOUT_MAX_FAILURES - 1)
        self.attempt_login(password=TEST_PASSWORD, attempt=500)  # success -- resets

        # A fresh window: the same number of failures again must not lock
        # on top of the pre-reset ones...
        response = self.fail_repeatedly(LOCKOUT_MAX_FAILURES - 1)
        self.assertEqual(response.status_code, 400)

        # ...and a correct login still goes through.
        response = self.attempt_login(password=TEST_PASSWORD, attempt=501)
        self.assertEqual(response.status_code, 200)

    def test_lockout_is_scoped_to_the_account_not_global(self):
        self.register(email="someone-else@example.com")
        self.client.cookies.clear()
        self.fail_repeatedly(LOCKOUT_MAX_FAILURES)  # locks patient@example.com

        response = self.attempt_login(
            email="someone-else@example.com", password=TEST_PASSWORD, attempt=500
        )

        self.assertEqual(response.status_code, 200)
