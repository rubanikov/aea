"""`GET /scheduling/availability` -- read-only since the schedule API
landed: it returns the requesting user's *currently-effective* generation
(the hours that are live today), so consumers like the provider calendar's
hour bounds never double-count a pending change. All writes go through
`PUT /scheduling/schedule` (see `test_schedule_api.py`); the retired
per-row write endpoints are pinned to stay gone at the bottom of this
file.
"""

from datetime import timedelta

from django.utils import timezone as django_timezone

from scheduling.models import Availability

from .helpers import SchedulingAPITestCase


class AvailabilityListTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.other_provider = self.create_provider(email="other-provider@example.com")

    def test_list_only_returns_the_requesting_providers_own_rows(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        Availability.objects.create(
            provider=self.other_provider, day_of_week=1, start_time="10:00", end_time="14:00"
        )
        self.login_as(self.provider)

        response = self.client.get("/scheduling/availability")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["day_of_week"], 0)
        # Baseline rows (created before the generations feature) surface an
        # explicit null `effective_from` rather than omitting the key.
        self.assertIsNone(body[0]["effective_from"])

    def test_list_is_empty_for_a_provider_with_no_working_hours_configured(self):
        self.login_as(self.provider)

        response = self.client.get("/scheduling/availability")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_list_returns_only_the_live_generation_while_a_pending_one_exists(self):
        live_row = Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        Availability.objects.create(
            provider=self.provider,
            day_of_week=0,
            start_time="10:00",
            end_time="12:00",
            effective_from=django_timezone.now().date() + timedelta(days=10),
        )
        self.login_as(self.provider)

        body = self.client.get("/scheduling/availability").json()

        self.assertEqual([row["id"] for row in body], [live_row.id])

    def test_list_returns_a_passed_pending_generation_as_the_live_one(self):
        # The dated generation's start date has passed, so it -- not the
        # stale baseline -- is what's live today, even before any write
        # normalizes the table.
        Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        passed_date = django_timezone.now().date() - timedelta(days=3)
        current_row = Availability.objects.create(
            provider=self.provider,
            day_of_week=0,
            start_time="10:00",
            end_time="14:00",
            effective_from=passed_date,
        )
        self.login_as(self.provider)

        body = self.client.get("/scheduling/availability").json()

        self.assertEqual([row["id"] for row in body], [current_row.id])
        self.assertEqual(body[0]["effective_from"], passed_date.isoformat())

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/scheduling/availability")

        self.assertEqual(response.status_code, 401)


class RetiredWriteEndpointTests(SchedulingAPITestCase):
    """The three write paths `PUT /scheduling/schedule` superseded stay
    retired -- they were the only ways to inject a row into the wrong
    generation or bypass the overlap/gap rules."""

    def setUp(self):
        self.provider = self.create_provider()
        self.availability = Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.login_as(self.provider)

    def test_post_availability_is_gone(self):
        response = self.post_json(
            "/scheduling/availability",
            {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"},
        )

        self.assertEqual(response.status_code, 405)
        self.assertEqual(Availability.objects.count(), 1)

    def test_delete_availability_row_is_gone(self):
        response = self.delete_json(f"/scheduling/availability/{self.availability.id}")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Availability.objects.filter(pk=self.availability.id).exists())

    def test_check_collisions_is_gone(self):
        response = self.post_json(
            "/scheduling/availability/check-collisions",
            {"windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}]},
        )

        self.assertEqual(response.status_code, 404)
