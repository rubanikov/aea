from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.utils import timezone as django_timezone

from audit.models import AuditLog
from bookings.models import Booking
from scheduling.models import AppointmentType, BlockedTime

from .helpers import TEST_PASSWORD, SchedulingAPITestCase

User = get_user_model()


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class BlockedTimeListCreateTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.patient = self.create_patient()

    def test_provider_creates_a_blocked_range(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z", "label": "Vacation"},
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["label"], "Vacation")
        blocked_time = BlockedTime.objects.get(pk=body["id"])
        self.assertEqual(blocked_time.provider_id, self.provider.id)

    def test_create_writes_an_audit_entry(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z"},
        )

        blocked_time_id = response.json()["id"]
        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.action, "create:blocked_time")
        self.assertEqual(entry.target_type, "blocked_time")
        self.assertEqual(entry.target_id, str(blocked_time_id))

    def test_label_is_optional(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["label"], "")

    def test_created_row_is_always_scoped_to_the_authenticated_provider(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {
                "start": "2026-08-20T00:00:00Z",
                "end": "2026-08-27T00:00:00Z",
                "provider": self.other_provider.id,
            },
        )

        self.assertEqual(response.status_code, 201)
        blocked_time = BlockedTime.objects.get(pk=response.json()["id"])
        self.assertEqual(blocked_time.provider_id, self.provider.id)

    def test_patient_cannot_create_blocked_time(self):
        self.login_as(self.patient)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(BlockedTime.objects.count(), 0)

    def test_rejects_end_before_start(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-27T00:00:00Z", "end": "2026-08-20T00:00:00Z"},
        )

        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_request_is_rejected(self):
        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z"},
        )

        self.assertEqual(response.status_code, 401)

    def test_list_only_returns_the_requesting_providers_own_rows(self):
        BlockedTime.objects.create(
            provider=self.provider, start="2026-08-20T00:00:00Z", end="2026-08-27T00:00:00Z"
        )
        BlockedTime.objects.create(
            provider=self.other_provider,
            start="2026-09-01T00:00:00Z",
            end="2026-09-02T00:00:00Z",
        )
        self.login_as(self.provider)

        response = self.client.get("/scheduling/blocked-time")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)

    def test_list_is_empty_for_a_provider_with_no_blocked_time_configured(self):
        # Backs the frontend's "No blocked time yet" empty state -- the
        # list endpoint must return a clean `[]`, not an error, when a
        # provider hasn't blocked anything.
        self.login_as(self.provider)

        response = self.client.get("/scheduling/blocked-time")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class BlockedTimeCollisionTests(SchedulingAPITestCase):
    """TICKET-11, project.md edge case 3: `POST /scheduling/blocked-time`
    guarded against orphaning an existing confirmed booking. Pure
    collision-detection logic is covered directly in `test_collisions.py`;
    this class exercises the HTTP contract on top of it.
    """

    def setUp(self):
        self.provider = self.create_provider()
        self.patient = self.create_patient()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
            patient=self.patient,
        )

    def test_a_block_that_does_not_overlap_any_booking_is_created_with_no_collisions(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-20T00:00:00Z", "end": "2026-08-27T00:00:00Z"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("collisions", response.json())
        self.assertEqual(BlockedTime.objects.count(), 1)

    def test_a_block_that_would_orphan_a_confirmed_booking_is_rejected_with_409(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-17T08:00:00Z", "end": "2026-08-17T12:00:00Z"},
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(len(body["collisions"]), 1)
        entry = body["collisions"][0]
        self.assertEqual(entry["id"], self.booking.id)
        self.assertEqual(
            entry["start_time"],
            self.booking.start_time.isoformat().replace("+00:00", "Z"),
        )
        self.assertEqual(
            entry["end_time"],
            self.booking.end_time.isoformat().replace("+00:00", "Z"),
        )
        self.assertEqual(entry["patient_name"], self.patient.name)
        self.assertEqual(entry["appointment_type_name"], "Follow-up")
        self.assertEqual(entry["status"], "confirmed")
        # Nothing was created.
        self.assertEqual(BlockedTime.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_block_overlapping_a_booking_beyond_day_133_is_created_without_409(self):
        beyond_start = django_timezone.now() + timedelta(days=134)
        beyond_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=beyond_start,
            patient=self.patient,
        )
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {
                "start": beyond_start.isoformat().replace("+00:00", "Z"),
                "end": (beyond_start + timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
            },
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("collisions", response.json())
        beyond_booking.refresh_from_db()
        self.assertEqual(beyond_booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(BlockedTime.objects.count(), 1)

    def test_keep_new_hours_creates_the_block_and_writes_an_audit_entry_per_booking(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {
                "start": "2026-08-17T08:00:00Z",
                "end": "2026-08-17T12:00:00Z",
                "resolution": "keep_new_hours",
            },
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(len(body["collisions"]), 1)
        self.assertEqual(body["collisions"][0]["id"], self.booking.id)
        self.assertEqual(BlockedTime.objects.count(), 1)

        # The booking itself is never touched.
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

        actions = list(AuditLog.objects.values_list("action", flat=True))
        self.assertIn("create:blocked_time", actions)
        self.assertIn("availability_change:booking_flagged_as_exception", actions)
        flag_entry = AuditLog.objects.get(
            action="availability_change:booking_flagged_as_exception"
        )
        self.assertEqual(flag_entry.target_type, "booking")
        self.assertEqual(flag_entry.target_id, str(self.booking.id))
        self.assertNotIn("patient", str(flag_entry.metadata))

    def test_cancel_change_creates_nothing(self):
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {
                "start": "2026-08-17T08:00:00Z",
                "end": "2026-08-17T12:00:00Z",
                "resolution": "cancel_change",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"collisions": [], "resolution": "cancel_change"})
        self.assertEqual(BlockedTime.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_a_cancelled_booking_never_appears_in_the_collision_list(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])
        self.login_as(self.provider)

        response = self.post_json(
            "/scheduling/blocked-time",
            {"start": "2026-08-17T08:00:00Z", "end": "2026-08-17T12:00:00Z"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(BlockedTime.objects.count(), 1)


class BlockedTimeDeleteTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider()
        self.other_provider = self.create_provider(email="other-provider@example.com")
        self.blocked_time = BlockedTime.objects.create(
            provider=self.provider,
            start="2026-08-20T00:00:00Z",
            end="2026-08-27T00:00:00Z",
        )

    def test_provider_deletes_their_own_row(self):
        self.login_as(self.provider)

        response = self.delete_json(f"/scheduling/blocked-time/{self.blocked_time.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(BlockedTime.objects.filter(pk=self.blocked_time.id).exists())

    def test_delete_writes_an_audit_entry(self):
        self.login_as(self.provider)

        self.delete_json(f"/scheduling/blocked-time/{self.blocked_time.id}")

        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.action, "delete:blocked_time")
        self.assertEqual(entry.target_type, "blocked_time")
        self.assertEqual(entry.target_id, str(self.blocked_time.id))

    def test_cannot_delete_another_providers_blocked_time(self):
        self.login_as(self.other_provider)

        response = self.delete_json(f"/scheduling/blocked-time/{self.blocked_time.id}")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(BlockedTime.objects.filter(pk=self.blocked_time.id).exists())

    def test_deleting_a_nonexistent_row_returns_404(self):
        self.login_as(self.provider)

        response = self.delete_json("/scheduling/blocked-time/999999")

        self.assertEqual(response.status_code, 404)

    def test_admin_can_delete_another_providers_blocked_time_and_both_events_are_audited(self):
        admin = User.objects.create_user(
            email="admin@example.com", password=TEST_PASSWORD, role=User.Role.ADMIN
        )
        self.login_as(admin)

        response = self.delete_json(f"/scheduling/blocked-time/{self.blocked_time.id}")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(BlockedTime.objects.filter(pk=self.blocked_time.id).exists())
        # Two distinct facts logged: the admin-bypass permission decision
        # (from `IsOwnerOrAdmin`) and the domain event itself (from the
        # view, same as any provider's own delete).
        actions = set(AuditLog.objects.values_list("action", flat=True))
        self.assertIn("admin_bypass:delete:blocked_time", actions)
        self.assertIn("delete:blocked_time", actions)
