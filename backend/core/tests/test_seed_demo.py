from io import StringIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

User = get_user_model()


class SeedDemoCommandTests(TestCase):
    def setUp(self):
        # The login rate throttle's counters live in the shared default
        # cache, which persists across test modules within a single test
        # run — see accounts/tests/test_throttle.py.
        cache.clear()

    def test_runs_successfully_and_lists_the_demo_accounts_it_created(self):
        out = StringIO()

        call_command("seed_demo", stdout=out)

        output = out.getvalue()
        self.assertIn("admin", output)
        self.assertIn("provider", output)
        self.assertIn("patient", output)

    def test_creates_one_account_per_role(self):
        call_command("seed_demo", stdout=StringIO())

        self.assertEqual(User.objects.filter(role=User.Role.ADMIN).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PROVIDER).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PATIENT).count(), 1)

    def test_is_idempotent(self):
        call_command("seed_demo", stdout=StringIO())
        call_command("seed_demo", stdout=StringIO())

        self.assertEqual(User.objects.count(), 3)

    def test_demo_accounts_can_log_in_with_the_seeded_password(self):
        from accounts.tests.helpers import AJAX_HEADERS

        call_command("seed_demo", stdout=StringIO())

        response = self.client.post(
            "/auth/login",
            {"email": "patient@demo.aea.test", "password": "demo-password-not-for-prod"},
            content_type="application/json",
            **AJAX_HEADERS,
        )

        self.assertEqual(response.status_code, 200)
