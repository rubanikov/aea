"""HTTP-seam tests for `PATCH /bookings/<id>/reschedule` (TICKET-10) --
permissions (the same *patient*-ownership axis as
`test_booking_cancel_api.py`), the response shape, the notice-rule reuse,
TICKET-07's double-booking guard reused against the *new* slot, and the
"reschedule atomically frees the old slot and occupies the new one"
acceptance criterion, exercised end-to-end through the real `GET
/scheduling/slots` endpoint (not just a DB-row check). The genuinely
concurrent version of the double-booking-guard race is
`test_concurrency.py`, not here -- this file only needs sequential,
single-request cases.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

from audit.models import AuditLog
from bookings.models import Booking
from scheduling.models import BlockedTime

from .helpers import BookingsAPITestCase


def _utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


# A Monday, matching `setup_bookable_provider`'s `day_of_week=0`
# availability window (09:00-17:00 UTC) -- every "new open slot" this file
# reschedules into is some hour on this date.
MONDAY = "2026-08-17"

PAST_START = _utc(2020, 1, 6, 9, 0)
FAR_FUTURE_START = _utc(2099, 1, 5, 9, 0)


class BookingRescheduleTests(BookingsAPITestCase):
    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()
        self.booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=FAR_FUTURE_START,
        )

    def _reschedule(self, booking_id, start_time, **extra_fields):
        return self.patch_json(
            f"/bookings/{booking_id}/reschedule",
            {"start_time": start_time, **extra_fields},
        )

    def test_patient_can_reschedule_their_own_upcoming_booking_to_an_open_slot(self):
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(
            set(body.keys()),
            {
                "id",
                "provider_id",
                "patient_id",
                "appointment_type_id",
                "start_time",
                "end_time",
                "status",
                "cancellation_reason",
                "previous_booking_id",
            },
        )
        self.assertNotEqual(body["id"], self.booking.id)
        self.assertEqual(body["provider_id"], self.provider.id)
        self.assertEqual(body["patient_id"], self.patient.id)
        self.assertEqual(body["appointment_type_id"], self.appointment_type.id)
        self.assertEqual(body["start_time"], f"{MONDAY}T10:00:00Z")
        self.assertEqual(body["end_time"], f"{MONDAY}T11:00:00Z")
        self.assertEqual(body["status"], "confirmed")
        self.assertEqual(body["previous_booking_id"], self.booking.id)

        new_booking = Booking.objects.get(pk=body["id"])
        self.assertEqual(new_booking.status, Booking.Status.CONFIRMED)

        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        # The old booking's own start/end time is untouched -- it is a
        # cancelled record of the original appointment, not repointed at
        # the new time.
        self.assertEqual(self.booking.start_time, FAR_FUTURE_START)

    def test_reschedule_writes_three_linked_audit_entries(self):
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")
        new_id = response.json()["id"]

        old_entries = AuditLog.objects.filter(
            target_type="booking", target_id=str(self.booking.id)
        )
        new_entries = AuditLog.objects.filter(target_type="booking", target_id=str(new_id))

        cancel_entry = old_entries.get(action="status:confirmed->cancelled")
        self.assertEqual(cancel_entry.actor_id, self.patient.id)

        confirm_entry = new_entries.get(action="status:requested->confirmed")
        self.assertIsNone(confirm_entry.actor_id)

        link_entry = new_entries.get(action="reschedule:booking")
        self.assertEqual(link_entry.actor_id, self.patient.id)
        self.assertEqual(
            link_entry.metadata, {"old_booking_id": self.booking.id, "new_booking_id": new_id}
        )

        self.assertEqual(AuditLog.objects.count(), 3)

    def test_reschedule_attempt_inside_the_notice_window_on_the_original_booking_is_rejected(
        self,
    ):
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=1),
        )
        original_start_time = soon_booking.start_time
        self.login_as(self.patient)

        response = self._reschedule(soon_booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 400)
        self.assertIn("24 hours", response.json()["detail"])
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(soon_booking.start_time, original_start_time)
        # No replacement booking was created either.
        self.assertEqual(Booking.objects.filter(start_time=f"{MONDAY}T10:00:00Z").count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_reschedule_target_outside_working_hours_is_rejected(self):
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T20:00:00Z")

        self.assertEqual(response.status_code, 400)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(Booking.objects.count(), 1)

    def test_reschedule_target_inside_a_blocked_range_is_rejected(self):
        BlockedTime.objects.create(
            provider=self.provider, start=f"{MONDAY}T10:00:00Z", end=f"{MONDAY}T12:00:00Z"
        )
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 400)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(Booking.objects.count(), 1)

    def test_reschedule_target_in_the_past_is_rejected(self):
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, "2020-01-06T09:00:00Z")

        self.assertEqual(response.status_code, 400)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(Booking.objects.count(), 1)

    def test_reschedule_to_the_bookings_own_current_slot_does_not_self_conflict(self):
        # `get_open_slots` generates back-to-back, non-overlapping slots for
        # a single (provider, appointment_type) pair (each slot's start is
        # the previous one's end -- scheduling/slots.py's discretization
        # loop), so the *only* way a reschedule target can ever coincide
        # with the booking's own current window is the identical start_time
        # -- there's no such thing as a same-type slot that partially
        # overlaps another. This is that case: "reschedule" to the exact
        # time already booked. Before the cancel-before-book reorder in
        # `reschedule_booking`, this would spuriously 409 -- the old
        # booking, still `CONFIRMED` at the moment `_book_open_slot` ran its
        # conflict check, would be found as its own conflicting row.
        self.booking.start_time = _utc(2026, 8, 17, 9, 0)
        self.booking.end_time = _utc(2026, 8, 17, 10, 0)
        self.booking.save()
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T09:00:00Z")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["start_time"], f"{MONDAY}T09:00:00Z")
        self.assertEqual(body["status"], "confirmed")

    def test_reschedule_target_already_occupied_by_another_booking_is_rejected(self):
        other_patient = self.create_patient(email="other-patient@example.com")
        self.make_booking(
            provider=self.provider,
            patient=other_patient,
            appointment_type=self.appointment_type,
            start_time=_utc(2026, 8, 17, 10, 0),
        )
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 409)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(
            Booking.objects.filter(
                provider=self.provider, start_time=_utc(2026, 8, 17, 10, 0)
            ).count(),
            1,
        )

    def test_reschedule_to_an_hour_the_patient_already_holds_elsewhere_is_rejected(self):
        other_provider, other_type = self.setup_bookable_provider(
            email="other-doc@example.com"
        )
        self.make_booking(
            provider=other_provider,
            patient=self.patient,
            appointment_type=other_type,
            start_time=_utc(2026, 8, 17, 10, 0),
        )
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 409)
        self.assertIn("already have an appointment", response.json()["detail"])
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_unauthenticated_request_is_rejected(self):
        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 401)

    def test_patient_cannot_reschedule_someone_elses_booking(self):
        other_patient = self.create_patient(email="other-patient@example.com")
        self.login_as(other_patient)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_a_provider_cannot_use_this_endpoint_for_their_own_booking(self):
        self.login_as(self.provider)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CONFIRMED)

    def test_admin_can_reschedule_any_booking_and_the_bypass_is_audited(self):
        admin = self.create_provider(email="admin@example.com")
        admin.role = admin.Role.ADMIN
        admin.save(update_fields=["role"])
        self.login_as(admin)

        response = self._reschedule(self.booking.id, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 200)
        bypass_entry = AuditLog.objects.get(action="admin_bypass:patch:booking")
        self.assertEqual(bypass_entry.actor_id, admin.id)
        self.assertEqual(bypass_entry.target_type, "booking")
        self.assertEqual(bypass_entry.target_id, str(self.booking.id))
        link_entry = AuditLog.objects.get(action="reschedule:booking")
        self.assertEqual(link_entry.actor_id, admin.id)
        cancel_entry = AuditLog.objects.get(action="status:confirmed->cancelled")
        self.assertEqual(cancel_entry.actor_id, admin.id)

    def test_unknown_booking_id_returns_404(self):
        self.login_as(self.patient)

        response = self._reschedule(999999, f"{MONDAY}T10:00:00Z")

        self.assertEqual(response.status_code, 404)

    def test_missing_start_time_in_body_returns_400(self):
        self.login_as(self.patient)

        response = self.patch_json(f"/bookings/{self.booking.id}/reschedule", {})

        self.assertEqual(response.status_code, 400)

    def test_malformed_start_time_returns_400(self):
        self.login_as(self.patient)

        response = self._reschedule(self.booking.id, "not-a-datetime")

        self.assertEqual(response.status_code, 400)

    def test_provider_id_and_appointment_type_id_in_the_body_are_silently_ignored(self):
        # The endpoint only accepts `start_time` -- these fields have
        # nothing to bind to (`BookingRescheduleSerializer`), so a client
        # (or an attacker) sending them cannot move the booking to a
        # different provider or appointment type.
        self.login_as(self.patient)

        response = self._reschedule(
            self.booking.id,
            f"{MONDAY}T10:00:00Z",
            provider_id=999999,
            appointment_type_id=999999,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["provider_id"], self.provider.id)
        self.assertEqual(body["appointment_type_id"], self.appointment_type.id)

    def test_rescheduling_a_booking_in_a_terminal_status_is_rejected_and_nothing_persists(self):
        self.login_as(self.patient)

        for terminal_status in (
            Booking.Status.CANCELLED,
            Booking.Status.COMPLETED,
            Booking.Status.NO_SHOW,
        ):
            with self.subTest(status=terminal_status):
                terminal_booking = self.make_booking(
                    provider=self.provider,
                    patient=self.patient,
                    appointment_type=self.appointment_type,
                    start_time=FAR_FUTURE_START,
                    status=terminal_status,
                )
                bookings_before = Booking.objects.count()
                audit_entries_before = AuditLog.objects.count()

                response = self._reschedule(terminal_booking.id, f"{MONDAY}T10:00:00Z")

                self.assertEqual(response.status_code, 400)
                terminal_booking.refresh_from_db()
                self.assertEqual(terminal_booking.status, terminal_status)
                self.assertEqual(Booking.objects.count(), bookings_before)
                self.assertEqual(AuditLog.objects.count(), audit_entries_before)


class RescheduleFreesTheOldSlotAndOccupiesTheNewOneTests(BookingsAPITestCase):
    """TICKET-10's atomicity acceptance criterion, exercised end-to-end:
    book a slot through the real `POST /bookings` flow, reschedule it
    through this ticket's endpoint, then immediately re-query the real
    `GET /scheduling/slots` for both windows and confirm the old one is
    open again and the new one is gone -- not just that the DB rows'
    `status` columns changed underneath it.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider(timezone="UTC")
        self.patient = self.create_patient()

    def _slots(self, date):
        return self.client.get(
            "/scheduling/slots"
            f"?provider_id={self.provider.id}"
            f"&appointment_type_id={self.appointment_type.id}"
            f"&date_from={date}&date_to={date}"
        )

    def test_rescheduling_reopens_the_old_slot_and_occupies_the_new_one(self):
        self.login_as(self.patient)
        old_date = "2026-08-17"  # a Monday
        new_date = "2026-08-24"  # the following Monday -- same weekly rule

        create_response = self.post_json(
            "/bookings",
            {
                "provider_id": self.provider.id,
                "appointment_type_id": self.appointment_type.id,
                "start_time": f"{old_date}T09:00:00Z",
            },
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        booking_id = create_response.json()["id"]

        new_slot_before = self._slots(new_date)
        self.assertIn(
            {"start": f"{new_date}T09:00:00Z", "end": f"{new_date}T10:00:00Z"},
            new_slot_before.json()["slots"],
        )

        reschedule_response = self.patch_json(
            f"/bookings/{booking_id}/reschedule", {"start_time": f"{new_date}T09:00:00Z"}
        )
        self.assertEqual(reschedule_response.status_code, 200, reschedule_response.content)

        old_slots_after = self._slots(old_date)
        self.assertIn(
            {"start": f"{old_date}T09:00:00Z", "end": f"{old_date}T10:00:00Z"},
            old_slots_after.json()["slots"],
        )
        new_slots_after = self._slots(new_date)
        self.assertNotIn(
            {"start": f"{new_date}T09:00:00Z", "end": f"{new_date}T10:00:00Z"},
            new_slots_after.json()["slots"],
        )
