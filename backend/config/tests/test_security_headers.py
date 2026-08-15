"""HSTS (settings.py's SECURE_HSTS_* pair).

SECURE_HSTS_SECONDS/SECURE_HSTS_INCLUDE_SUBDOMAINS are computed from DEBUG
at settings import time, and DEBUG itself follows the ambient DJANGO_DEBUG
env var (True in a local .env, False in CI) -- so these tests pin the
production values with override_settings instead of trusting whichever
environment happens to be running the suite. The overridden values below
must mirror settings.py's `not DEBUG` branch. The header only rides on
responses to HTTPS requests, which `secure=True` simulates."""

from django.test import TestCase, override_settings


@override_settings(SECURE_HSTS_SECONDS=31536000, SECURE_HSTS_INCLUDE_SUBDOMAINS=True)
class HstsHeaderTests(TestCase):
    def test_https_responses_carry_hsts_for_a_year_including_subdomains(self):
        response = self.client.get("/health", secure=True)

        # No `preload` -- deliberately omitted (see settings.py): it
        # requires browser preload-list submission and is effectively
        # irreversible.
        self.assertEqual(
            response.headers["Strict-Transport-Security"],
            "max-age=31536000; includeSubDomains",
        )

    def test_plain_http_responses_do_not_claim_hsts(self):
        # The header is only meaningful over HTTPS; browsers ignore it on
        # plain HTTP, and SecurityMiddleware correspondingly omits it.
        response = self.client.get("/health")

        self.assertNotIn("Strict-Transport-Security", response.headers)
