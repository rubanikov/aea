"""API-seam tests for `POST /scheduling/availability/check-collisions`
(TICKET-11, project.md edge case 3). Pure collision-detection logic is
covered directly in `test_collisions.py`; this file exercises the HTTP
contract -- status codes, response shape, audit writes, and that a plain
no-collision check never touches any `Availability`/`Booking` row.
"""

from datetime import datetime
from datetime import timezone as dt_timezone

from audit.models import AuditLog
from bookings.models import Booking
from scheduling.models import AppointmentType, Availability

from .helpers import SchedulingAPITestCase

CHECK_COLLISIONS_PATH = "/scheduling/availability/check-collisions"


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# Monday 2026-08-17 09:00-10:00 UTC.
MONDAY_BOOKING_START = "2026-08-17T09:00:00Z"


class AvailabilityCollisionCheckTests(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.patient = self.create_patient()
        self.original_availability = Availability.objects.create(
            provider=self.provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 9, 0),
            patient=self.patient,
        )

    def test_a_shrink_that_does_not_affect_any_booking_applies_with_no_collisions(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "08:00", "end_time": "12:00"}]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"collisions": []})
        # Nothing was ever written -- this endpoint only ever detects.
        self.assertEqual(Availability.objects.count(), 1)
        self.assertEqual(Availability.objects.get().start_time.strftime("%H:%M"), "09:00")
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_a_shrink_that_would_orphan_a_confirmed_booking_is_rejected_with_409(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}]},
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(len(body["collisions"]), 1)
        entry = body["collisions"][0]
        self.assertEqual(entry["id"], self.booking.id)
        self.assertEqual(entry["start_time"], MONDAY_BOOKING_START)
        self.assertEqual(entry["end_time"], "2026-08-17T10:00:00Z")
        self.assertEqual(entry["patient_name"], self.patient.name)
        self.assertEqual(entry["appointment_type_name"], "Follow-up")
        self.assertEqual(entry["status"], "confirmed")
        # Availability is confirmed unchanged in the DB -- the conflicting
        # edit was never applied.
        self.assertEqual(Availability.objects.count(), 1)
        self.assertEqual(Availability.objects.get().start_time.strftime("%H:%M"), "09:00")
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_keep_new_hours_acknowledges_the_collision_and_writes_an_audit_entry_per_booking(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {
                "windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}],
                "resolution": "keep_new_hours",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["resolution"], "keep_new_hours")
        self.assertEqual(len(body["collisions"]), 1)
        self.assertEqual(body["collisions"][0]["id"], self.booking.id)

        # The booking itself is never touched.
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(self.booking.start_time, _utc(2026, 8, 17, 9, 0))

        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.action, "availability_change:booking_flagged_as_exception")
        self.assertEqual(entry.target_type, "booking")
        self.assertEqual(entry.target_id, str(self.booking.id))
        # No PHI in the audit metadata (architecture.md §6).
        self.assertNotIn("patient", str(entry.metadata))

    def test_cancel_change_leaves_everything_untouched(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {
                "windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}],
                "resolution": "cancel_change",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"collisions": [], "resolution": "cancel_change"})
        self.assertEqual(Availability.objects.count(), 1)
        self.assertEqual(Availability.objects.get().start_time.strftime("%H:%M"), "09:00")
        self.assertEqual(AuditLog.objects.count(), 0)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_a_cancelled_booking_never_appears_in_the_collision_list(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"collisions": []})

    def test_patient_cannot_check_collisions(self):
        self.login_as(self.patient)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}]},
        )

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}]},
        )

        self.assertEqual(response.status_code, 401)

    def test_rejects_a_window_with_end_time_before_start_time(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {"windows": [{"day_of_week": 0, "start_time": "17:00", "end_time": "09:00"}]},
        )

        self.assertEqual(response.status_code, 400)

    def test_an_empty_windows_list_flags_every_active_booking(self):
        # Removing every day entirely -- e.g. the provider unchecked every
        # weekday -- is checked the same way as a partial shrink.
        self.login_as(self.provider)

        response = self.post_json(CHECK_COLLISIONS_PATH, {"windows": []})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(response.json()["collisions"]), 1)

    def test_an_unrecognized_resolution_value_is_rejected(self):
        self.login_as(self.provider)

        response = self.post_json(
            CHECK_COLLISIONS_PATH,
            {
                "windows": [{"day_of_week": 0, "start_time": "10:00", "end_time": "17:00"}],
                "resolution": "not-a-real-choice",
            },
        )

        self.assertEqual(response.status_code, 400)
