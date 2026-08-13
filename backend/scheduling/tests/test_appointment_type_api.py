from django.contrib.auth import get_user_model

from audit.models import AuditLog
from scheduling.models import AppointmentType

from .helpers import TEST_PASSWORD, SchedulingAPITestCase

User = get_user_model()


class AppointmentTypeListCreateTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.patient = self.create_patient()

    def test_provider_creates_an_appointment_type_by_sending_only_a_name(self):
        self.login_as(self.provider)

        response = self.post_json("/scheduling/appointment-types", {"name": "Follow-up"})

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], "Follow-up")
        # Every appointment is a fixed 60-minute slot -- the server always
        # produces 60; the field stays in the output for display.
        self.assertEqual(body["duration_minutes"], 60)
        appointment_type = AppointmentType.objects.get(pk=body["id"])
        self.assertEqual(appointment_type.provider_id, self.provider.id)
        self.assertEqual(appointment_type.duration_minutes, 60)

    def test_client_supplied_duration_is_ignored_on_create(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 15}
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["duration_minutes"], 60)
        self.assertEqual(AppointmentType.objects.get().duration_minutes, 60)

    def test_even_an_invalid_duration_value_is_ignored_not_rejected(self):
        # `duration_minutes` is read-only, so DRF never validates it -- a
        # garbage value is dropped on the floor, not a 400.
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": -15}
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["duration_minutes"], 60)

    def test_patient_cannot_create_an_appointment_type(self):
        self.login_as(self.patient)

        response = self.post_json("/scheduling/appointment-types", {"name": "Follow-up"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(AppointmentType.objects.count(), 0)

    def test_rejects_duplicate_name_for_the_same_provider(self):
        self.login_as(self.provider)
        self.post_json("/scheduling/appointment-types", {"name": "Follow-up"})

        response = self.post_json("/scheduling/appointment-types", {"name": "Follow-up"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_list_only_returns_the_requesting_providers_own_types(self):
        AppointmentType.objects.create(provider=self.provider, name="Follow-up")
        AppointmentType.objects.create(provider=self.other_provider, name="Physical")
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
            provider=self.provider, name="Follow-up"
        )

    def test_rejects_a_rename_that_collides_with_another_of_the_providers_own_types(self):
        AppointmentType.objects.create(provider=self.provider, name="Physical")
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}", {"name": "Physical"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())

    def test_provider_renames_their_own_appointment_type(self):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"name": "Extended Follow-up"},
        )

        self.assertEqual(response.status_code, 200)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.name, "Extended Follow-up")

    def test_client_supplied_duration_is_ignored_on_update(self):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 20},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["duration_minutes"], 60)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 60)

    def test_cannot_update_another_providers_appointment_type(self):
        # See test_availability_api.py's equivalent test for why this is
        # 403, not 404, after the TICKET-05 `IsOwnerOrAdmin` retrofit.
        self.login_as(self.other_provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"name": "Hijacked"},
        )

        self.assertEqual(response.status_code, 403)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.name, "Follow-up")

    def test_provider_deletes_their_own_appointment_type(self):
        self.login_as(self.provider)

        response = self.delete_json(f"/scheduling/appointment-types/{self.appointment_type.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(AppointmentType.objects.filter(pk=self.appointment_type.id).exists())

    def test_cannot_delete_another_providers_appointment_type(self):
        self.login_as(self.other_provider)

        response = self.delete_json(f"/scheduling/appointment-types/{self.appointment_type.id}")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(AppointmentType.objects.filter(pk=self.appointment_type.id).exists())

    def test_updating_a_nonexistent_type_returns_404(self):
        self.login_as(self.provider)

        response = self.patch_json("/scheduling/appointment-types/999999", {"name": "Ghost"})

        self.assertEqual(response.status_code, 404)

    def test_admin_can_delete_another_providers_appointment_type_and_the_bypass_is_audited(self):
        admin = User.objects.create_user(
            email="admin@example.com", password=TEST_PASSWORD, role=User.Role.ADMIN
        )
        self.login_as(admin)

        response = self.delete_json(f"/scheduling/appointment-types/{self.appointment_type.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(AppointmentType.objects.filter(pk=self.appointment_type.id).exists())
        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, admin)
        self.assertEqual(entry.action, "admin_bypass:delete:appointmenttype")
