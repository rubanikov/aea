from django.contrib.auth import get_user_model

from scheduling.models import AppointmentType

from .helpers import TEST_PASSWORD, SchedulingAPITestCase

User = get_user_model()


class ProviderListTests(SchedulingAPITestCase):
    """`GET /scheduling/providers` (TICKET-06) -- the patient-facing
    provider picker."""

    def test_any_authenticated_user_sees_the_provider_list(self):
        provider = self.create_provider(
            email="alice@example.com", name="Dr. Alice", timezone="America/New_York"
        )
        self.create_patient()  # never a provider, must never show up below
        self.login_as(self.create_patient(email="viewer@example.com"))

        response = self.client.get("/scheduling/providers")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(
            body[0], {"id": provider.id, "name": "Dr. Alice", "timezone": "America/New_York"}
        )

    def test_only_provider_role_users_are_returned(self):
        self.create_provider(email="provider@example.com")
        patient = self.create_patient(email="patient@example.com")
        self.login_as(patient)

        response = self.client.get("/scheduling/providers")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertNotIn(patient.id, [row["id"] for row in body])

    def test_admin_users_are_not_listed_as_providers(self):
        User.objects.create_user(
            email="admin@example.com", password=TEST_PASSWORD, role=User.Role.ADMIN
        )
        self.login_as(self.create_patient())

        response = self.client.get("/scheduling/providers")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_does_not_leak_email_or_phone(self):
        self.create_provider(email="provider@example.com")
        self.login_as(self.create_patient())

        response = self.client.get("/scheduling/providers")

        body = response.json()
        self.assertEqual(set(body[0].keys()), {"id", "name", "timezone"})

    def test_empty_list_when_no_providers_exist(self):
        self.login_as(self.create_patient())

        response = self.client.get("/scheduling/providers")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/scheduling/providers")

        self.assertEqual(response.status_code, 401)


class ProviderAppointmentTypesTests(SchedulingAPITestCase):
    """`GET /scheduling/providers/<id>/appointment-types` (TICKET-06) -- the
    services a specific provider offers, for a patient choosing what to
    book before browsing slots."""

    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other@example.com")
        self.patient = self.create_patient()

    def test_lists_only_that_providers_own_appointment_types(self):
        AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=15
        )
        AppointmentType.objects.create(
            provider=self.other_provider, name="Physical", duration_minutes=45
        )
        self.login_as(self.patient)

        response = self.client.get(f"/scheduling/providers/{self.provider.id}/appointment-types")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["name"], "Follow-up")
        self.assertEqual(body[0]["duration_minutes"], 15)
        self.assertEqual(set(body[0].keys()), {"id", "name", "duration_minutes"})

    def test_empty_list_for_a_provider_with_no_appointment_types_configured(self):
        self.login_as(self.patient)

        response = self.client.get(f"/scheduling/providers/{self.provider.id}/appointment-types")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_unknown_provider_id_returns_404(self):
        self.login_as(self.patient)

        response = self.client.get("/scheduling/providers/999999/appointment-types")

        self.assertEqual(response.status_code, 404)

    def test_a_patient_id_used_as_the_provider_id_returns_404(self):
        self.login_as(self.patient)

        response = self.client.get(f"/scheduling/providers/{self.patient.id}/appointment-types")

        self.assertEqual(response.status_code, 404)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get(f"/scheduling/providers/{self.provider.id}/appointment-types")

        self.assertEqual(response.status_code, 401)
