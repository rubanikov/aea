from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone as django_timezone

from audit.models import AuditLog
from bookings.models import Booking
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
        # `duration_minutes` is optional on input: omitting it keeps the
        # model default of 60.
        self.assertEqual(body["duration_minutes"], 60)
        appointment_type = AppointmentType.objects.get(pk=body["id"])
        self.assertEqual(appointment_type.provider_id, self.provider.id)
        self.assertEqual(appointment_type.duration_minutes, 60)

    def test_provider_creates_a_30_minute_appointment_type(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/appointment-types", {"name": "Quick check", "duration_minutes": 30}
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["duration_minutes"], 30)
        self.assertEqual(AppointmentType.objects.get().duration_minutes, 30)

    def test_a_duration_outside_the_two_choices_is_rejected_with_a_clear_message(self):
        self.login_as(self.provider)

        for bad_duration in (15, 45, 90, -15, 0):
            with self.subTest(duration=bad_duration):
                response = self.post_json(
                    "/scheduling/appointment-types",
                    {"name": "Follow-up", "duration_minutes": bad_duration},
                )

                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json()["duration_minutes"],
                    ["Slot length must be 30 or 60 minutes."],
                )
        self.assertEqual(AppointmentType.objects.count(), 0)

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

    def test_provider_changes_the_duration_when_no_future_bookings_exist_and_it_is_audited(self):
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 30},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["duration_minutes"], 30)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 30)
        entry = AuditLog.objects.get(action="update:appointment_type_duration")
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.target_id, str(self.appointment_type.id))
        self.assertEqual(entry.metadata, {"duration_from": 60, "duration_to": 30})

    def test_a_duration_change_with_future_active_bookings_is_refused_with_the_collision_list(self):
        booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=django_timezone.now() + timedelta(days=7),
        )
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 30},
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertIn("slot length", body["detail"])
        self.assertEqual([c["id"] for c in body["collisions"]], [booking.id])
        self.assertEqual(body["collisions"][0]["patient_name"], booking.patient.name)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 60)
        # Nothing was accepted, so nothing was audited.
        self.assertFalse(
            AuditLog.objects.filter(action="update:appointment_type_duration").exists()
        )

    def test_past_and_inactive_bookings_never_block_a_duration_change(self):
        # A completed past visit and a cancelled future one: neither was
        # booked against the future grid the change redraws.
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=django_timezone.now() - timedelta(days=7),
        )
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=django_timezone.now() + timedelta(days=7),
            status=Booking.Status.CANCELLED,
        )
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 30},
        )

        self.assertEqual(response.status_code, 200)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.duration_minutes, 30)

    def test_a_rename_is_never_blocked_by_future_bookings(self):
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=django_timezone.now() + timedelta(days=7),
        )
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"name": "Extended Follow-up"},
        )

        self.assertEqual(response.status_code, 200)
        self.appointment_type.refresh_from_db()
        self.assertEqual(self.appointment_type.name, "Extended Follow-up")

    def test_resubmitting_the_current_duration_is_a_no_op_not_a_conflict(self):
        # An unchanged `duration_minutes: 60` alongside future bookings:
        # no grid changes, so no 409 and no duration audit entry.
        self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=django_timezone.now() + timedelta(days=7),
        )
        self.login_as(self.provider)

        response = self.patch_json(
            f"/scheduling/appointment-types/{self.appointment_type.id}",
            {"duration_minutes": 60},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            AuditLog.objects.filter(action="update:appointment_type_duration").exists()
        )

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
