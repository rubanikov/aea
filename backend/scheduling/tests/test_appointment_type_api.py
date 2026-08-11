from scheduling.models import AppointmentType

from .helpers import SchedulingAPITestCase


class AppointmentTypeListCreateTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.patient = self.create_patient()

    def test_provider_creates_an_appointment_type(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 15}
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], "Follow-up")
        self.assertEqual(body["duration_minutes"], 15)
        appointment_type = AppointmentType.objects.get(pk=body["id"])
        self.assertEqual(appointment_type.provider_id, self.provider.id)

    def test_patient_cannot_create_an_appointment_type(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 15}
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(AppointmentType.objects.count(), 0)

    def test_rejects_zero_duration(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 0}
        )

        self.assertEqual(response.status_code, 400)

    def test_rejects_negative_duration(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": -15}
        )

        self.assertEqual(response.status_code, 400)

    def test_rejects_duplicate_name_for_the_same_provider(self):
        self.login_as(self.provider)
        self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 15}
        )

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 30}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_list_only_returns_the_requesting_providers_own_types(self):
        AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=15
        )
        AppointmentType.objects.create(
            provider=self.other_provider, name="Physical", duration_minutes=45
        )
        self.login_as(self.provider)

        response = self.client.get("/scheduling/appointment-types")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["name"], "Follow-up")

    def test_list_is_empty_for_a_provider_with_no_appointment_types_configured(self):
        self.login_as(self.provider)

        response = self.client.get("/scheduling/appointment-types")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class AppointmentTypeDetailTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=15
        )

    def test_rejects_a_rename_that_collides_with_another_of_the_providers_own_types(self):
        AppointmentType.objects.create(provider=self.provider, name="Physical", duration_minutes=45)
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}", {"name": "Physical"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_provider_updates_their_own_appointment_type(self):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 20},
        )

        self.assertEqual(response.status_code, 200)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 20)

    def test_cannot_update_another_providers_appointment_type(self):
        self.login_as(self.other_provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 20},
        )

        self.assertEqual(response.status_code, 404)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 15)

    def test_provider_deletes_their_own_appointment_type(self):
        self.login_as(self.provider)

        response = self.delete_json(f"/scheduling/appointment-types/{self.appointment_type.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(AppointmentType.objects.filter(pk=self.appointment_type.id).exists())

    def test_cannot_delete_another_providers_appointment_type(self):
        self.login_as(self.other_provider)

        response = self.delete_json(f"/scheduling/appointment-types/{self.appointment_type.id}")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(AppointmentType.objects.filter(pk=self.appointment_type.id).exists())

    def test_updating_a_nonexistent_type_returns_404(self):
        self.login_as(self.provider)

        response = self.patch_json("/scheduling/appointment-types/999999", {"duration_minutes": 20})

        self.assertEqual(response.status_code, 404)
