"""API-seam tests for `GET`/`PUT /scheduling/schedule` -- the
whole-generation schedule read/write pair that replaced the per-row
availability endpoints. Pure generation-selection and collision logic is
covered directly in `test_collisions.py`/`test_slots.py`; this file
exercises the HTTP contract: status codes, response shapes, validation
messages keyed by day index, the deferred-apply path, normalization on
write, audit entries, and that a 409 never writes anything.

Date fixtures are derived from the real clock (the view resolves "today"
from `django_timezone.now()`), pushed far enough into the future that the
133-day collision horizon always covers them.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.utils import timezone as django_timezone

from audit.models import AuditLog
from scheduling.models import AppointmentType, Availability

from .helpers import SchedulingAPITestCase, next_monday

SCHEDULE_PATH = "/scheduling/schedule"
PENDING_PATH = "/scheduling/schedule/pending"

MONDAY = 0
TUESDAY = 1


def _offset_clinic():
    """A timezone whose local calendar date differs from UTC's *right
    now*, plus that local date. At any instant at least one of UTC+14
    (already on tomorrow once UTC passes 10:00) and UTC-11 (still on
    yesterday until UTC passes 11:00) qualifies -- so the clinic-time
    tests never depend on what time of day the suite runs."""
    now = django_timezone.now()
    for name in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):
        local_date = now.astimezone(ZoneInfo(name)).date()
        if local_date != now.date():
            return name, local_date
    raise AssertionError("unreachable: the two offsets span more than 24 hours")


def _window(day_of_week, start_time, end_time):
    return {"day_of_week": day_of_week, "start_time": start_time, "end_time": end_time}


class ScheduleTestCase(SchedulingAPITestCase):
    def setUp(self):
        self.provider = self.create_provider(timezone="UTC")
        self.patient = self.create_patient()
        self.today = django_timezone.now().astimezone(ZoneInfo("UTC")).date()
        self.tomorrow = self.today + timedelta(days=1)


class ScheduleGetTests(ScheduleTestCase):
    def test_returns_timezone_today_current_and_pending(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        pending_date = self.today + timedelta(days=10)
        Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time="10:00",
            end_time="12:00",
            effective_from=pending_date,
        )
        self.login_as(self.provider)

        response = self.client.get(SCHEDULE_PATH)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["timezone"], "UTC")
        self.assertEqual(body["today"], self.today.isoformat())
        self.assertIsNone(body["current"]["effective_from"])
        self.assertEqual(len(body["current"]["windows"]), 1)
        window = body["current"]["windows"][0]
        self.assertEqual(window["day_of_week"], MONDAY)
        self.assertEqual(window["start_time"], "09:00:00")
        self.assertEqual(window["end_time"], "17:00:00")
        self.assertIn("id", window)
        self.assertEqual(body["pending"]["effective_from"], pending_date.isoformat())
        self.assertEqual(len(body["pending"]["windows"]), 1)

    def test_pending_is_null_when_no_future_generation_exists(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        self.login_as(self.provider)

        body = self.client.get(SCHEDULE_PATH).json()

        self.assertIsNone(body["pending"])

    def test_current_windows_may_be_empty(self):
        self.login_as(self.provider)

        body = self.client.get(SCHEDULE_PATH).json()

        self.assertEqual(body["current"], {"effective_from": None, "windows": []})
        self.assertIsNone(body["pending"])

    def test_windows_are_sorted_by_day_then_start_time(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=TUESDAY, start_time="09:00", end_time="12:00"
        )
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="14:00", end_time="17:00"
        )
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="12:00"
        )
        self.login_as(self.provider)

        windows = self.client.get(SCHEDULE_PATH).json()["current"]["windows"]

        self.assertEqual(
            [(w["day_of_week"], w["start_time"]) for w in windows],
            [(MONDAY, "09:00:00"), (MONDAY, "14:00:00"), (TUESDAY, "09:00:00")],
        )

    def test_a_pending_generation_whose_date_has_passed_reads_as_current(self):
        # No write has normalized the table since the date passed -- the
        # read applies the general selection rule, so the dated generation
        # governs and its start date surfaces as `current.effective_from`.
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        passed_date = self.today - timedelta(days=3)
        Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time="10:00",
            end_time="14:00",
            effective_from=passed_date,
        )
        self.login_as(self.provider)

        body = self.client.get(SCHEDULE_PATH).json()

        self.assertEqual(body["current"]["effective_from"], passed_date.isoformat())
        self.assertEqual(body["current"]["windows"][0]["start_time"], "10:00:00")
        self.assertIsNone(body["pending"])

    def test_today_is_the_provider_local_date_not_utc(self):
        clinic_tz, clinic_today = _offset_clinic()
        provider = self.create_provider(email="offset@example.com", timezone=clinic_tz)
        self.login_as(provider)

        body = self.client.get(SCHEDULE_PATH).json()

        self.assertEqual(body["today"], clinic_today.isoformat())
        self.assertNotEqual(body["today"], django_timezone.now().date().isoformat())

    def test_patient_gets_403(self):
        self.login_as(self.patient)

        response = self.client.get(SCHEDULE_PATH)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(), {"detail": "Only providers can configure working hours."}
        )

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get(SCHEDULE_PATH)

        self.assertEqual(response.status_code, 401)


class SchedulePutSuccessTests(ScheduleTestCase):
    def test_multi_block_put_replaces_the_live_generation(self):
        # Pre-existing live rows must be replaced wholesale, not appended to.
        Availability.objects.create(
            provider=self.provider, day_of_week=TUESDAY, start_time="08:00", end_time="16:00"
        )
        self.login_as(self.provider)

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [
                    _window(MONDAY, "09:00", "12:00"),
                    _window(MONDAY, "14:00", "17:00"),
                    _window(TUESDAY, "09:00:00", "17:00:00"),  # HH:MM:SS accepted too
                ],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIsNone(body["current"]["effective_from"])
        written = body["current"]["windows"]
        self.assertEqual(
            [(w["day_of_week"], w["start_time"], w["end_time"]) for w in written],
            [
                (MONDAY, "09:00:00", "12:00:00"),
                (MONDAY, "14:00:00", "17:00:00"),
                (TUESDAY, "09:00:00", "17:00:00"),
            ],
        )
        self.assertIsNone(body["pending"])
        rows = Availability.objects.filter(provider=self.provider)
        self.assertEqual(rows.count(), 3)
        self.assertTrue(all(row.effective_from is None for row in rows))

    def test_put_with_future_effective_from_creates_pending_and_leaves_live_untouched(self):
        live_row = Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        pending_date = self.today + timedelta(days=10)
        self.login_as(self.provider)

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "10:00", "12:00")],
                "effective_from": pending_date.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["pending"]["effective_from"], pending_date.isoformat())
        self.assertEqual(body["pending"]["windows"][0]["start_time"], "10:00:00")
        # The live generation is byte-for-byte untouched -- same row, same id.
        self.assertEqual([w["id"] for w in body["current"]["windows"]], [live_row.id])
        live_row.refresh_from_db()
        self.assertIsNone(live_row.effective_from)

    def test_put_with_null_effective_from_leaves_the_pending_generation_intact(self):
        pending_date = self.today + timedelta(days=10)
        pending_row = Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time="10:00",
            end_time="12:00",
            effective_from=pending_date,
        )
        self.login_as(self.provider)

        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "09:00", "17:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["pending"]["effective_from"], pending_date.isoformat())
        self.assertEqual([w["id"] for w in body["pending"]["windows"]], [pending_row.id])

    def test_a_second_pending_change_replaces_the_first(self):
        self.login_as(self.provider)
        first_date = self.today + timedelta(days=10)
        second_date = self.today + timedelta(days=20)
        self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "10:00", "12:00")],
                "effective_from": first_date.isoformat(),
            },
        )

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(TUESDAY, "13:00", "15:00")],
                "effective_from": second_date.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()["pending"]["effective_from"], second_date.isoformat()
        )
        # One pending generation at a time -- the first one's rows are gone.
        self.assertFalse(
            Availability.objects.filter(
                provider=self.provider, effective_from=first_date
            ).exists()
        )

    def test_writing_normalizes_superseded_generations(self):
        # A dated generation whose date has passed currently governs; the
        # stale baseline behind it is dead. Any write collapses the
        # effective generation to NULL and deletes everything older.
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        passed_date = self.today - timedelta(days=3)
        Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time="10:00",
            end_time="14:00",
            effective_from=passed_date,
        )
        pending_date = self.today + timedelta(days=10)
        self.login_as(self.provider)

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(TUESDAY, "10:00", "12:00")],
                "effective_from": pending_date.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        rows = Availability.objects.filter(provider=self.provider)
        # The passed generation collapsed to NULL (keeping its 10:00-14:00
        # windows as the live hours), the stale baseline is deleted, and
        # the new pending generation sits alongside.
        live = rows.filter(effective_from__isnull=True)
        self.assertEqual(
            [(row.day_of_week, str(row.start_time)) for row in live],
            [(MONDAY, "10:00:00")],
        )
        self.assertEqual(rows.filter(effective_from=pending_date).count(), 1)
        self.assertEqual(rows.count(), 2)

    def test_empty_windows_clears_all_hours(self):
        Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        self.login_as(self.provider)

        response = self.put_json(SCHEDULE_PATH, {"windows": [], "effective_from": None})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["current"], {"effective_from": None, "windows": []})
        self.assertFalse(Availability.objects.filter(provider=self.provider).exists())

    def test_immediate_apply_writes_an_update_audit_entry(self):
        self.login_as(self.provider)

        self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "09:00", "17:00")], "effective_from": None},
        )

        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.action, "update:availability_schedule")
        self.assertEqual(entry.target_type, "availability_schedule")
        self.assertEqual(entry.target_id, str(self.provider.id))

    def test_deferred_apply_writes_a_schedule_audit_entry_with_the_date(self):
        pending_date = self.today + timedelta(days=10)
        self.login_as(self.provider)

        self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "17:00")],
                "effective_from": pending_date.isoformat(),
            },
        )

        entry = AuditLog.objects.get()
        self.assertEqual(entry.action, "schedule:availability_change")
        self.assertEqual(entry.metadata, {"effective_from": pending_date.isoformat()})

    def test_put_is_always_scoped_to_the_authenticated_provider(self):
        other_provider = self.create_provider(email="other-provider@example.com")
        other_row = Availability.objects.create(
            provider=other_provider, day_of_week=MONDAY, start_time="08:00", end_time="16:00"
        )
        self.login_as(self.provider)

        # A smuggled `provider` key is silently ignored -- the serializer
        # has no such field and the view always writes under request.user.
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "17:00")],
                "effective_from": None,
                "provider": other_provider.id,
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        created = Availability.objects.filter(provider=self.provider)
        self.assertEqual(created.count(), 1)
        other_row.refresh_from_db()
        self.assertEqual(str(other_row.start_time), "08:00:00")
        self.assertEqual(Availability.objects.filter(provider=other_provider).count(), 1)


class SchedulePutValidationTests(ScheduleTestCase):
    def setUp(self):
        super().setUp()
        self.login_as(self.provider)

    def test_overlapping_blocks_are_rejected_keyed_by_day_index(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "12:00"), _window(MONDAY, "11:00", "14:00")],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(), {"windows": {"0": ["Blocks on the same day can't overlap."]}}
        )
        self.assertEqual(Availability.objects.count(), 0)

    def test_blocks_less_than_one_hour_apart_are_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [
                    _window(TUESDAY, "09:00", "12:00"),
                    _window(TUESDAY, "12:30", "14:00"),
                ],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {"windows": {"1": ["Blocks on the same day must be at least 1 hour apart."]}},
        )

    def test_touching_blocks_are_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "12:00"), _window(MONDAY, "12:00", "14:00")],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {"windows": {"0": ["Blocks on the same day must be at least 1 hour apart."]}},
        )

    def test_blocks_exactly_one_hour_apart_are_valid(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "12:00"), _window(MONDAY, "13:00", "17:00")],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 200, response.content)

    def test_end_time_not_after_start_time_is_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(3, "17:00", "09:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(), {"windows": {"3": ["End time must be after start time."]}}
        )

    def test_effective_from_today_is_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "17:00")],
                "effective_from": self.today.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {"effective_from": ["Effective date must be a future date in your timezone."]},
        )

    def test_effective_from_in_the_past_is_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "09:00", "17:00")],
                "effective_from": (self.today - timedelta(days=5)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("effective_from", response.json())

    def test_effective_from_validation_uses_the_clinic_timezone_not_utc(self):
        # A clinic whose local date differs from UTC's right now: the
        # clinic-local "today" must be rejected and clinic-local "tomorrow"
        # accepted, regardless of what UTC's calendar says about either.
        clinic_tz, clinic_today = _offset_clinic()
        provider = self.create_provider(email="offset@example.com", timezone=clinic_tz)
        self.login_as(provider)
        windows = [_window(MONDAY, "09:00", "17:00")]

        rejected = self.put_json(
            SCHEDULE_PATH,
            {"windows": windows, "effective_from": clinic_today.isoformat()},
        )
        accepted = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": windows,
                "effective_from": (clinic_today + timedelta(days=1)).isoformat(),
            },
        )

        self.assertEqual(rejected.status_code, 400)
        self.assertIn("effective_from", rejected.json())
        self.assertEqual(accepted.status_code, 200, accepted.content)

    def test_missing_effective_from_key_is_rejected(self):
        response = self.put_json(
            SCHEDULE_PATH, {"windows": [_window(MONDAY, "09:00", "17:00")]}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("effective_from", response.json())

    def test_day_of_week_out_of_range_falls_through_to_drf_errors(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(7, "09:00", "17:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 400)

    def test_patient_cannot_put(self):
        self.login_as(self.patient)

        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "09:00", "17:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Availability.objects.count(), 0)

    def test_unauthenticated_put_is_rejected(self):
        self.client.cookies.clear()

        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "09:00", "17:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 401)


class SchedulePutCollisionTests(ScheduleTestCase):
    """The 409 path: a proposed timeline that would strand an active
    booking is rejected outright with the collision list and
    `earliest_safe_date` -- nothing is ever written."""

    def setUp(self):
        super().setUp()
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.live_row = Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )
        # Monday 09:00-10:00 UTC, at least a week out -- inside the live
        # window and well within the 133-day collision horizon.
        self.booking_date = next_monday()
        self.booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=datetime.combine(
                self.booking_date, datetime.min.time(), tzinfo=dt_timezone.utc
            )
            + timedelta(hours=9),
            patient=self.patient,
        )
        self.login_as(self.provider)

    def test_immediate_put_that_would_strand_a_booking_is_rejected_with_409(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "10:00", "17:00")], "effective_from": None},
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
        # Day after the colliding booking's provider-local end date.
        self.assertEqual(
            body["earliest_safe_date"],
            (self.booking_date + timedelta(days=1)).isoformat(),
        )
        # Nothing was written -- the live row is exactly as before.
        rows = Availability.objects.filter(provider=self.provider)
        self.assertEqual([row.id for row in rows], [self.live_row.id])
        self.live_row.refresh_from_db()
        self.assertEqual(str(self.live_row.start_time), "09:00:00")
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_effective_from_earlier_than_the_earliest_safe_date_is_rejected_with_409(self):
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "10:00", "17:00")],
                "effective_from": self.tomorrow.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual([entry["id"] for entry in body["collisions"]], [self.booking.id])
        self.assertEqual(
            body["earliest_safe_date"],
            (self.booking_date + timedelta(days=1)).isoformat(),
        )
        self.assertFalse(
            Availability.objects.filter(provider=self.provider)
            .exclude(pk=self.live_row.pk)
            .exists()
        )

    def test_effective_from_on_or_after_the_earliest_safe_date_is_accepted(self):
        safe_date = self.booking_date + timedelta(days=1)

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(MONDAY, "10:00", "17:00")],
                "effective_from": safe_date.isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["pending"]["effective_from"], safe_date.isoformat())

    def test_earliest_safe_date_is_null_when_deferring_cannot_clear_the_collision(self):
        # A pending generation with no Monday hours starts *before* the
        # Monday booking, so the booking's date is governed by the pending
        # generation, not the live one being written -- deferring the live
        # edit can never rescue it. (State like this is only reachable by
        # direct writes; the API itself would have 409'd the pending save.)
        Availability.objects.create(
            provider=self.provider,
            day_of_week=TUESDAY,
            start_time="09:00",
            end_time="17:00",
            effective_from=self.booking_date - timedelta(days=3),
        )

        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "08:00", "16:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual([entry["id"] for entry in body["collisions"]], [self.booking.id])
        self.assertIsNone(body["earliest_safe_date"])

    def test_editing_live_hours_never_flags_a_booking_the_pending_generation_covers(self):
        # The booking sits after a pending change that still covers it --
        # shrinking the *live* Monday hours is fine, whatever they say.
        Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time="09:00",
            end_time="11:00",
            effective_from=self.booking_date - timedelta(days=3),
        )

        response = self.put_json(
            SCHEDULE_PATH,
            {"windows": [_window(MONDAY, "13:00", "16:00")], "effective_from": None},
        )

        self.assertEqual(response.status_code, 200, response.content)

    def test_a_deferred_change_only_collides_with_bookings_on_or_after_its_date(self):
        # New pending hours that exclude Mondays, effective the day *after*
        # the Monday booking -- the booking stays governed by the live
        # generation, so there is no collision.
        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [_window(TUESDAY, "09:00", "17:00")],
                "effective_from": (self.booking_date + timedelta(days=1)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200, response.content)

    def test_put_that_would_strand_a_booking_beyond_day_133_is_accepted(self):
        # Bookings on day 134+ sit outside the default collision horizon, so
        # schedule changes that would orphan them are allowed.
        beyond_date = django_timezone.now().date() + timedelta(days=134)
        day_of_week = beyond_date.weekday()
        beyond_booking = self.create_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=datetime.combine(
                beyond_date, datetime.min.time(), tzinfo=dt_timezone.utc
            )
            + timedelta(hours=9),
            patient=self.patient,
        )

        response = self.put_json(
            SCHEDULE_PATH,
            {
                "windows": [
                    _window(MONDAY, "09:00", "17:00"),
                    _window(day_of_week, "10:00", "17:00"),
                ],
                "effective_from": None,
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        beyond_booking.refresh_from_db()
        self.assertEqual(beyond_booking.status, "confirmed")


class PendingScheduleDeleteTests(ScheduleTestCase):
    """`DELETE /scheduling/schedule/pending` -- discard the pending
    generation outright. Live rows are untouched, no collision check ever
    blocks the delete, and bookings are never auto-cancelled: a booking
    made under the pending hours that no longer fits the restored live
    hours is flagged in the audit log instead."""

    def setUp(self):
        super().setUp()
        self.live_row = Availability.objects.create(
            provider=self.provider, day_of_week=MONDAY, start_time="09:00", end_time="17:00"
        )

    def _create_pending(self, effective_from, start_time="10:00", end_time="12:00"):
        return Availability.objects.create(
            provider=self.provider,
            day_of_week=MONDAY,
            start_time=start_time,
            end_time=end_time,
            effective_from=effective_from,
        )

    def _create_monday_booking(self, booking_date, hour, **overrides):
        appointment_type, _ = AppointmentType.objects.get_or_create(
            provider=self.provider, name="Follow-up", defaults={"duration_minutes": 60}
        )
        return self.create_booking(
            provider=self.provider,
            appointment_type=appointment_type,
            start_time=datetime.combine(booking_date, datetime.min.time(), tzinfo=dt_timezone.utc)
            + timedelta(hours=hour),
            **overrides,
        )

    def test_delete_discards_the_pending_generation_and_leaves_live_hours_untouched(self):
        self._create_pending(self.today + timedelta(days=10))
        self.login_as(self.provider)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 204, response.content)
        rows = Availability.objects.filter(provider=self.provider)
        self.assertEqual([row.id for row in rows], [self.live_row.id])
        self.live_row.refresh_from_db()
        self.assertIsNone(self.live_row.effective_from)
        self.assertEqual(str(self.live_row.start_time), "09:00:00")
        self.assertIsNone(self.client.get(SCHEDULE_PATH).json()["pending"])

    def test_delete_with_no_pending_change_returns_404(self):
        self.login_as(self.provider)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "No pending schedule change."})
        self.assertTrue(Availability.objects.filter(pk=self.live_row.pk).exists())

    def test_a_dated_generation_whose_date_has_passed_is_not_pending(self):
        # Its date passed without a write, so it *is* the live schedule
        # (same rule the GET reads by) -- nothing pending, nothing deleted.
        self._create_pending(self.today - timedelta(days=3))
        self.login_as(self.provider)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Availability.objects.filter(provider=self.provider).count(), 2)

    def test_patient_gets_403(self):
        self.login_as(self.patient)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json(), {"detail": "Only providers can configure working hours."}
        )

    def test_unauthenticated_delete_is_rejected(self):
        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 401)

    def test_delete_writes_a_cancel_audit_entry_with_the_discarded_date(self):
        pending_date = self.today + timedelta(days=10)
        self._create_pending(pending_date)
        self.login_as(self.provider)

        self.delete_json(PENDING_PATH)

        entry = AuditLog.objects.get(action="cancel:availability_pending_change")
        self.assertEqual(entry.actor, self.provider)
        self.assertEqual(entry.target_type, "availability_schedule")
        self.assertEqual(entry.target_id, str(self.provider.id))
        self.assertEqual(entry.metadata, {"effective_from": pending_date.isoformat()})

    def test_a_booking_made_under_the_pending_hours_is_flagged_never_cancelled(self):
        booking_date = next_monday()
        self._create_pending(
            booking_date - timedelta(days=3), start_time="18:00", end_time="20:00"
        )
        # 18:00 Monday: inside the pending 18:00-20:00 window, outside the
        # restored live 09:00-17:00 hours -- stranded by the discard.
        stranded = self._create_monday_booking(booking_date, 18, patient=self.patient)
        # 10:00 Monday: the restored live hours still cover it.
        covered = self._create_monday_booking(booking_date, 10)
        self.login_as(self.provider)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 204, response.content)
        stranded.refresh_from_db()
        covered.refresh_from_db()
        self.assertEqual(stranded.status, "confirmed")
        self.assertEqual(covered.status, "confirmed")
        flags = AuditLog.objects.filter(
            action="availability_change:booking_flagged_as_exception"
        )
        self.assertEqual([entry.target_id for entry in flags], [str(stranded.id)])
        flag = flags.get()
        self.assertEqual(flag.actor, self.provider)
        self.assertEqual(flag.target_type, "booking")

    def test_a_booking_before_the_pending_date_is_never_flagged(self):
        # A booking outside the live hours but *before* the pending date
        # was never governed by the pending generation -- discarding the
        # pending change is not what strands it, so no flag is written.
        booking_date = next_monday()
        self._create_pending(
            booking_date + timedelta(days=1), start_time="18:00", end_time="20:00"
        )
        self._create_monday_booking(booking_date, 18, patient=self.patient)
        self.login_as(self.provider)

        response = self.delete_json(PENDING_PATH)

        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(
            AuditLog.objects.filter(
                action="availability_change:booking_flagged_as_exception"
            ).exists()
        )
