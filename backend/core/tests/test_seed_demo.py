from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class SeedDemoCommandTests(TestCase):
    def test_runs_successfully_and_lists_the_demo_accounts_it_would_create(self):
        out = StringIO()

        call_command("seed_demo", stdout=out)

        output = out.getvalue()
        self.assertIn("admin", output)
        self.assertIn("provider", output)
        self.assertIn("patient", output)
