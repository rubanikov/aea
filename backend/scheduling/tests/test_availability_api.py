from scheduling.models import Availability

from .helpers import SchedulingAPITestCase


class AvailabilityListCreateTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.patient = self.create_patient()

    def test_provider_creates_a_working_hours_row(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/availability",
            {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"},
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["day_of_week"], 0)
        self.assertEqual(body["start_time"], "09:00:00")
        self.assertEqual(body["end_time"], "17:00:00")
        availability = Availability.objects.get(pk=body["id"])
        self.assertEqual(availability.provider_id, self.provider.id)

    def test_created_row_is_always_scoped_to_the_authenticated_provider(self):
        # Even if a client tried to smuggle a different provider id in, the
        # serializer has no `provider` field at all -- the view sets it.
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/availability",
            {
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "17:00",
                "provider": self.other_provider.id,
            },
        )

        self.assertEqual(response.status_code, 201)
        availability = Availability.objects.get(pk=response.json()["id"])
        self.assertEqual(availability.provider_id, self.provider.id)

    def test_patient_cannot_create_working_hours(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/scheduling/availability",
            {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Availability.objects.count(), 0)

    def test_rejects_end_time_before_start_time(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/availability",
            {"day_of_week": 0, "start_time": "17:00", "end_time": "09:00"},
        )

        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_request_is_rejected(self):
        response = self.post_json(
            "/scheduling/availability",
            {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"},
        )

        self.assertEqual(response.status_code, 401)

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

    def test_list_is_empty_for_a_provider_with_no_working_hours_configured(self):
        self.login_as(self.provider)

        response = self.client.get("/scheduling/availability")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class AvailabilityDeleteTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.availability = Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )

    def test_provider_deletes_their_own_row(self):
        self.login_as(self.provider)

        response = self.delete_json(f"/scheduling/availability/{self.availability.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Availability.objects.filter(pk=self.availability.id).exists())

    def test_cannot_delete_another_providers_row(self):
        self.login_as(self.other_provider)

        response = self.delete_json(f"/scheduling/availability/{self.availability.id}")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Availability.objects.filter(pk=self.availability.id).exists())

    def test_deleting_a_nonexistent_row_returns_404(self):
        self.login_as(self.provider)

        response = self.delete_json("/scheduling/availability/999999")

        self.assertEqual(response.status_code, 404)
