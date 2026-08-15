"""Acceptance tests exercising the brief's own Core requirements and edge
cases (`project.md`) end to end, through the real HTTP surface, the way a
patient/provider/admin browser session would actually call it -- not a
restatement of each ticket's own unit/API test suite (see the citations in
each class's docstring below for what those already prove).

Organizational note: this file lives in `bookings/tests/` rather than a new
top-level `backend/acceptance/` app because `manage.py test` (the command CI
and this project's README both use, with no extra args) auto-discovers
tests only inside apps already listed in `INSTALLED_APPS`; a new
unregistered app would silently never run under that command, and
registering one requires an `INSTALLED_APPS` edit, which is application
code, out of scope for this pass. `bookings` is the natural existing home
for a cross-ticket acceptance suite: every journey below terminates in a
`Booking`, and this app already depends on `accounts`, `scheduling`, and
`audit`, so nothing here introduces a new cross-app dependency that isn't
already present in `bookings/services.py` itself.

Five independent things live in this file, each a genuine gap no single
ticket's own suite covers (see `bookings/tests/helpers.py`'s
`BookingsAPITestCase` and `scheduling/tests/helpers.py`'s
`SchedulingAPITestCase` for the inherited request/login helpers):

1. `FullBookingJourneyTests` -- the one true end-to-end story (register ->
   provider sets up availability/type/blocked-time -> patient discovers and
   books -> provider completes it), which no individual ticket's tests
   exercise as a single request-by-request sequence (each ticket correctly
   scopes its own tests to its own endpoint(s), with fixtures created
   directly against the ORM instead of replaying every prior step over
   HTTP).
2. `AccountDeletionCancelsUpcomingAppointmentsTests` -- the project.md
   Core #1 requirement that upcoming appointments are cancelled as part of
   the deletion flow, exercised against a patient who actually has one;
   every fixture in `accounts/tests/test_account_deletion.py` registers a
   patient with zero bookings.
3. `MalformedRequestBodyTests` -- project.md edge case 7's literal
   "malformed ... requests are rejected with clear errors" against a body
   that isn't valid JSON at all, distinct from every existing "malformed
   field" test (e.g. `test_booking_creation_api.py`'s
   `test_malformed_start_time_returns_400`), which all send syntactically
   valid JSON with one bad field.
4. `NoPHIInApplicationLogsTests` -- project.md's "no PHI in logs"
   requirement, spot-checked against real captured log output across a
   realistic register/book/cancel flow, the same technique
   `reminders/tests/test_emails.py`'s `ReminderEmailBodyContentTests`
   already uses for reminder email bodies, applied here to the
   application's own request logs.
5. `MultiBlockAndDeferredScheduleJourneyTests` -- end-to-end acceptance
   criterion for multi-block working hours and the deferred
   ("effective from") schedule change, observed from the *patient's* side
   of the fence: `scheduling/tests/test_schedule_api.py` pins down the
   `PUT /scheduling/schedule` write contract and
   `scheduling/tests/test_slots.py` the generation-selection math, but
   nothing drives provider-saves -> patient-queries-slots over HTTP and
   asserts the boundary flip inside one slot-query response.
"""

import json
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from accounts import services as account_services
from accounts.tests.helpers import AJAX_HEADERS, TEST_PASSWORD
from audit.models import AuditLog
from bookings.models import Booking
from scheduling.models import AppointmentType
from scheduling.tests.helpers import next_monday

from .helpers import BookingsAPITestCase

User = get_user_model()

# A Monday, comfortably in the future for the lifetime of this repo -- the
# same anchor date `test_booking_creation_api.py` and its siblings already
# use throughout, so this test relies on nothing this suite doesn't already
# depend on elsewhere.
MONDAY = "2026-08-17"

# A Monday far enough in the future to clear the 24h cancellation-notice
# window regardless of the real wall-clock date this suite happens to run
# on -- same constant value `bookings/tests/test_transitions.py`'s
# `FUTURE_START` and `test_booking_cancel_api.py`'s `FAR_FUTURE_START` use
# for exactly this reason.
FAR_FUTURE_MONDAY = "2099-01-05"


class FullBookingJourneyTests(BookingsAPITestCase):
    """project.md Core #1 (registration/auth), #2 (provider availability),
    #3 (slot discovery & booking), and #6 (status lifecycle), driven
    end-to-end in the order a real patient/provider session would actually
    call them. Core #4/#5/#7 and every edge case are deliberately left to
    their own dedicated suites (see this project's acceptance report) --
    this test's job is only to prove the pieces are wired together
    correctly as one system, not to re-derive every rule each ticket's own
    tests already pin down in isolation.
    """

    def test_register_set_up_availability_discover_book_and_complete(self):
        # -- Core #1: "a new patient can register and log in" --
        register_response = self.post_json(
            "/auth/register",
            {
                "email": "journey.patient@example.com",
                "password": TEST_PASSWORD,
                "name": "Journey Patient",
            },
        )
        self.assertEqual(register_response.status_code, 201, register_response.content)
        # Registration logs the session in immediately (no separate login
        # step needed) -- confirmed directly below via an authenticated
        # call, not assumed.
        patient = User.objects.get(email="journey.patient@example.com")

        # -- Core #1: "passwords are hashed (never stored in plaintext)" --
        self.assertNotEqual(patient.password, TEST_PASSWORD)
        self.assertTrue(patient.password.startswith("bcrypt_sha256$"))

        # -- Core #1: "an unauthenticated request to any patient resource
        # is rejected" -- checked against a fresh, cookie-less client so it
        # cannot ride on this test's own now-authenticated session.
        anonymous_response = Client().get("/bookings/mine")
        self.assertEqual(anonymous_response.status_code, 401)

        # Provider account provisioning happens through Django admin, not a
        # public endpoint (see `accounts/tests/test_admin_provisioning.py`,
        # which already exercises that real admin-panel flow) -- created
        # directly against the ORM here, same convention
        # `scheduling/tests/helpers.py`'s `create_provider` uses everywhere
        # else in this suite.
        provider = self.create_provider(
            email="dr.journey@example.com", name="Dr. Journey", timezone="UTC"
        )

        # -- Core #2: "a provider sets working hours (e.g. Mon-Fri
        # 09:00-17:00)" -- one whole-week `PUT /scheduling/schedule`
        # applied immediately (`effective_from: null`), exactly as the
        # working-hours form saves.
        self.login_as(provider)
        schedule_response = self.put_json(
            "/scheduling/schedule",
            {
                "windows": [
                    {"day_of_week": day_of_week, "start_time": "09:00", "end_time": "17:00"}
                    for day_of_week in range(5)  # Monday(0) .. Friday(4)
                ],
                "effective_from": None,
            },
        )
        self.assertEqual(schedule_response.status_code, 200, schedule_response.content)

        # -- Core #2: the provider defines a visit type by name only --
        # every appointment is a fixed 60-minute slot, so the client never
        # sends a duration.
        appointment_type_response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up"}
        )
        self.assertEqual(
            appointment_type_response.status_code, 201, appointment_type_response.content
        )
        appointment_type_id = appointment_type_response.json()["id"]

        # -- Core #2: "blocks a specific range" -- lunch, right in the
        # middle of the day the patient is about to browse.
        blocked_time_response = self.post_json(
            "/scheduling/blocked-time",
            {"start": f"{MONDAY}T12:00:00Z", "end": f"{MONDAY}T13:00:00Z", "label": "Lunch"},
        )
        self.assertEqual(blocked_time_response.status_code, 201, blocked_time_response.content)

        # -- Core #2: "the generated open-slot list reflects all three, and
        # blocked/past times never appear as bookable" -- checked from the
        # patient's own session, the way the real UI would query it.
        self.login_as(patient)
        slots_query = (
            "/scheduling/slots"
            f"?provider_id={provider.id}&appointment_type_id={appointment_type_id}"
            f"&date_from={MONDAY}&date_to={MONDAY}"
        )
        slots_response = self.client.get(slots_query)
        self.assertEqual(slots_response.status_code, 200)
        slots_body = slots_response.json()
        self.assertTrue(slots_body["bookable"])
        slot_starts = [slot["start"] for slot in slots_body["slots"]]
        self.assertIn(f"{MONDAY}T09:00:00Z", slot_starts)
        self.assertNotIn(f"{MONDAY}T12:00:00Z", slot_starts)  # blocked (lunch)

        # Past times never appear as bookable either -- a date range that
        # is already entirely in the past renders as a clean empty result,
        # not an error (also project.md edge case 7's empty-state clause).
        past_slots_response = self.client.get(
            "/scheduling/slots"
            f"?provider_id={provider.id}&appointment_type_id={appointment_type_id}"
            "&date_from=2020-01-06&date_to=2020-01-06"
        )
        self.assertEqual(past_slots_response.status_code, 200)
        self.assertEqual(past_slots_response.json()["slots"], [])

        # -- Core #3: "booking one creates a persisted appointment, returns
        # a confirmation, and immediately removes that slot from the open
        # list" --
        booking_response = self.post_json(
            "/bookings",
            {
                "provider_id": provider.id,
                "appointment_type_id": appointment_type_id,
                "start_time": f"{MONDAY}T09:00:00Z",
            },
        )
        self.assertEqual(booking_response.status_code, 201, booking_response.content)
        booking_body = booking_response.json()
        self.assertEqual(booking_body["status"], "confirmed")
        booking_id = booking_body["id"]

        after_booking_response = self.client.get(slots_query)
        after_slot_starts = [slot["start"] for slot in after_booking_response.json()["slots"]]
        self.assertNotIn(f"{MONDAY}T09:00:00Z", after_slot_starts)

        # -- Core #6: the provider sees the already-confirmed booking on
        # their own calendar (no confirm/decline step -- architecture.md
        # §4's auto-accept) and can move it requested->confirmed->completed.
        self.login_as(provider)
        provider_list_response = self.client.get("/bookings")
        self.assertEqual(provider_list_response.status_code, 200)
        provider_rows = provider_list_response.json()
        self.assertEqual(len(provider_rows), 1)
        self.assertEqual(provider_rows[0]["id"], booking_id)
        self.assertEqual(provider_rows[0]["patient_name"], "Journey Patient")
        self.assertEqual(provider_rows[0]["status"], "confirmed")

        complete_response = self.patch_json(
            f"/bookings/{booking_id}/status", {"status": "completed"}
        )
        self.assertEqual(complete_response.status_code, 200, complete_response.content)
        self.assertEqual(complete_response.json()["status"], "completed")

        # -- Core #6: "each change is recorded (see audit log)" -- the full
        # requested->confirmed->completed sequence, each entry actor-
        # appropriate (system for the auto-accept, the acting patient/
        # provider otherwise).
        entries = {
            entry.action: entry
            for entry in AuditLog.objects.filter(target_type="booking", target_id=str(booking_id))
        }
        self.assertIn("create:booking", entries)
        self.assertEqual(entries["create:booking"].actor_id, patient.id)
        self.assertIn("status:requested->confirmed", entries)
        self.assertIsNone(entries["status:requested->confirmed"].actor_id)
        self.assertIn("status:confirmed->completed", entries)
        self.assertEqual(entries["status:confirmed->completed"].actor_id, provider.id)

        booking = Booking.objects.get(pk=booking_id)
        self.assertEqual(booking.status, Booking.Status.COMPLETED)


class AccountDeletionCancelsUpcomingAppointmentsTests(BookingsAPITestCase):
    """project.md Core #1's retention companion: "Any upcoming appointments
    are cancelled as part of the deletion flow." Every fixture in
    `accounts/tests/test_account_deletion.py`'s `AccountDeletionTests`
    registers a patient with zero bookings (see e.g. that file's own
    `test_response_reports_zero_cancelled_appointments_for_now`) -- this is
    the one case that actually gives the patient an upcoming confirmed
    booking before requesting deletion.
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        register_response = self.post_json(
            "/auth/register",
            {
                "email": "deletion.patient@example.com",
                "password": TEST_PASSWORD,
                "name": "Deletion Patient",
            },
        )
        assert register_response.status_code == 201, register_response.content
        self.patient = User.objects.get(email="deletion.patient@example.com")

    def test_an_upcoming_confirmed_booking_is_cancelled_when_the_patient_deletes_their_account(
        self,
    ):
        booking_response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{FAR_FUTURE_MONDAY}T09:00:00Z",
        )
        self.assertEqual(booking_response.status_code, 201, booking_response.content)
        booking_id = booking_response.json()["id"]

        deletion_response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(deletion_response.status_code, 200, deletion_response.content)
        self.assertEqual(deletion_response.json()["cancelled_appointments_count"], 1)
        booking = Booking.objects.get(pk=booking_id)
        self.assertEqual(booking.status, Booking.Status.CANCELLED)

    def test_a_booking_inside_the_24h_cancellation_notice_window_is_still_cancelled(self):
        # `bookings.transitions.transition`'s 24h minimum-notice rule
        # would reject a plain cancel this close to `start_time`
        # (`CancellationNoticeTooShort`) -- account deletion is a
        # deliberate, narrow exception to that rule (see
        # `accounts.services._cancel_upcoming_appointments`'s
        # `enforce_notice=False` call), so this must succeed instead of
        # blocking (or silently skipping) the deletion.
        soon_booking = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(hours=2),
        )

        deletion_response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(deletion_response.status_code, 200, deletion_response.content)
        self.assertEqual(deletion_response.json()["cancelled_appointments_count"], 1)
        soon_booking.refresh_from_db()
        self.assertEqual(soon_booking.status, Booking.Status.CANCELLED)

    def test_past_and_already_terminal_bookings_are_left_alone_and_not_counted(self):
        past_completed = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() - timedelta(days=1),
            status=Booking.Status.COMPLETED,
        )
        already_cancelled = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(days=2),
            status=Booking.Status.CANCELLED,
        )

        deletion_response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(deletion_response.status_code, 200, deletion_response.content)
        self.assertEqual(deletion_response.json()["cancelled_appointments_count"], 0)
        past_completed.refresh_from_db()
        already_cancelled.refresh_from_db()
        self.assertEqual(past_completed.status, Booking.Status.COMPLETED)
        self.assertEqual(already_cancelled.status, Booking.Status.CANCELLED)

    def test_deletion_is_all_or_nothing_when_a_cancellation_fails_part_way(self):
        # `accounts.services.delete_account` runs the audit write, the
        # cancellation loop, and the PHI scrub in one transaction. Fail
        # the *second* cancellation and assert nothing from the first
        # half survived: no "deletion_requested" audit row, first booking
        # still confirmed, account still active with its PHI intact.
        first = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(days=3),
        )
        second = self.make_booking(
            provider=self.provider,
            patient=self.patient,
            appointment_type=self.appointment_type,
            start_time=timezone.now() + timedelta(days=4),
        )
        # The service imports `transition` at call time from
        # `bookings.transitions`, so patching the module attribute is enough.
        from bookings import transitions as transitions_module

        real_transition = transitions_module.transition
        calls = {"n": 0}

        def flaky_transition(booking, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("simulated failure on the second cancellation")
            return real_transition(booking, *args, **kwargs)

        with patch.object(transitions_module, "transition", flaky_transition):
            with self.assertRaises(RuntimeError):
                account_services.delete_account(self.patient)

        first.refresh_from_db()
        second.refresh_from_db()
        self.patient.refresh_from_db()
        self.assertEqual(first.status, Booking.Status.CONFIRMED)
        self.assertEqual(second.status, Booking.Status.CONFIRMED)
        self.assertTrue(self.patient.is_active)
        self.assertEqual(self.patient.email, "deletion.patient@example.com")
        self.assertIsNone(self.patient.deleted_at)
        self.assertFalse(
            AuditLog.objects.filter(
                action="account:deletion_requested", target_id=self.patient.id
            ).exists()
        )


class MalformedRequestBodyTests(BookingsAPITestCase):
    """project.md edge case 7: "All external input ... is validated and
    sanitized server-side, and malformed/oversized/out-of-range requests
    are rejected with clear errors" -- never an unhandled 500. Distinct
    from every existing "malformed field" test in this app (e.g.
    `test_booking_creation_api.py`'s `test_malformed_start_time_returns_400`,
    `accounts/tests/test_registration.py`'s `test_rejects_malformed_email`),
    which all send a syntactically valid JSON body with one bad field --
    this sends a body that isn't valid JSON at all, the more literal
    reading of "malformed request."
    """

    def setUp(self):
        self.provider, self.appointment_type = self.setup_bookable_provider()
        self.patient = self.create_patient()

    def test_booking_creation_with_an_unparseable_json_body_returns_400_not_500(self):
        self.login_as(self.patient)

        response = self.client.post(
            "/bookings",
            data="{this is not json::",
            content_type="application/json",
            **AJAX_HEADERS,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)

    def test_registration_with_an_unparseable_json_body_returns_400_not_500(self):
        response = self.client.post(
            "/auth/register",
            data="{this is not json::",
            content_type="application/json",
            **AJAX_HEADERS,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 2)  # setUp's provider + patient only

    def test_oversized_booking_body_is_rejected_with_413_before_parsing(self):
        # project.md's literal "oversized" case. The body below is valid
        # JSON, so nothing but the size ceiling
        # (`core.middleware.RequestBodySizeLimitMiddleware`,
        # `MAX_REQUEST_BODY_BYTES`) can be what rejects it.
        self.login_as(self.patient)
        padding = "x" * (settings.MAX_REQUEST_BODY_BYTES + 1)
        body = json.dumps(
            {
                "provider_id": self.provider.id,
                "appointment_type_id": self.appointment_type.id,
                "start_time": f"{FAR_FUTURE_MONDAY}T09:00:00Z",
                "padding": padding,
            }
        )

        response = self.client.post(
            "/bookings", data=body, content_type="application/json", **AJAX_HEADERS
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("too large", response.json()["detail"])
        self.assertEqual(Booking.objects.count(), 0)

    def test_a_normal_sized_body_is_untouched_by_the_size_ceiling(self):
        # Guards against the ceiling being set so low that a real payload
        # (a booking with a maximum-length 500-char cancellation reason,
        # say) would trip it.
        self.login_as(self.patient)
        response = self.post_booking(
            provider=self.provider,
            appointment_type=self.appointment_type,
            start_time=f"{FAR_FUTURE_MONDAY}T09:00:00Z",
        )

        self.assertEqual(response.status_code, 201, response.content)


class NoPHIInApplicationLogsTests(BookingsAPITestCase):
    """project.md: "No PHI in logs -- application/server logs must not
    contain PHI (names, DOB, contact details, health context); log
    identifiers/references instead." Every `logger.info(...)` call site in
    `accounts`/`bookings` already logs ids only by inspection, but nothing
    in the existing suite captures real log output across a realistic flow
    and asserts on it -- the same technique
    `reminders/tests/test_emails.py`'s `ReminderEmailBodyContentTests`
    already uses for reminder email bodies, applied here to the
    application's own request logs.
    """

    def setUp(self):
        # An explicit, non-empty provider name -- `create_provider`'s own
        # default leaves `name` blank, which would make
        # `assertNotIn(self.provider.name, ...)` below trivially pass (an
        # empty string is "in" every string), not a real assertion.
        self.provider, self.appointment_type = self.setup_bookable_provider(
            name="Dr. Confidential Provider"
        )

    def test_a_register_book_and_cancel_flow_never_logs_the_patients_name_or_email(self):
        patient_name = "Confidential Journey Patient"
        patient_email = "confidential.journey.patient@example.com"

        with self.assertLogs("accounts.views", level="INFO") as accounts_logs:
            register_response = self.post_json(
                "/auth/register",
                {"email": patient_email, "password": TEST_PASSWORD, "name": patient_name},
            )
        self.assertEqual(register_response.status_code, 201, register_response.content)

        with self.assertLogs("bookings.views", level="INFO") as booking_logs:
            booking_response = self.post_booking(
                provider=self.provider,
                appointment_type=self.appointment_type,
                start_time=f"{FAR_FUTURE_MONDAY}T09:00:00Z",
            )
        self.assertEqual(booking_response.status_code, 201, booking_response.content)
        booking_id = booking_response.json()["id"]

        with self.assertLogs("bookings.views", level="INFO") as cancel_logs:
            cancel_response = self.patch_json(f"/bookings/{booking_id}/cancel", {})
        self.assertEqual(cancel_response.status_code, 200, cancel_response.content)

        all_output = "\n".join(accounts_logs.output + booking_logs.output + cancel_logs.output)
        self.assertNotIn(patient_name, all_output)
        self.assertNotIn(patient_email, all_output)
        self.assertNotIn(self.provider.email, all_output)
        self.assertNotIn(self.provider.name, all_output)
        # The log lines are still meaningfully identifying by id -- this
        # isn't a test of "logs nothing," only "logs no PHI."
        self.assertIn(str(booking_id), all_output)


class MultiBlockAndDeferredScheduleJourneyTests(BookingsAPITestCase):
    """E2E acceptance criterion: provider saves multi-block hours -> the
    patient's bookable slots match those blocks (nothing in the gap) ->
    provider defers a different weekly picture with a future `effective_from`
    -> one slot query spanning the boundary returns the old hours strictly
    before that date and the new hours on/after it.

    The schedule/slots views resolve "today" from the real clock (never
    mocked here -- `CookieJWTAuthentication` shares
    `django.utils.timezone`), so every date is derived dynamically:
    `boundary_monday` is a Monday at least two weeks out, which keeps the
    old-hours Monday one week before it comfortably in the future too --
    no slot on either day can be eaten by the "past times are never
    bookable" rule, whatever wall-clock date the suite runs on.
    """

    OLD_WINDOWS = [
        {"day_of_week": 0, "start_time": "08:00", "end_time": "11:00"},
        {"day_of_week": 0, "start_time": "14:00", "end_time": "17:00"},
    ]
    NEW_WINDOWS = [{"day_of_week": 0, "start_time": "10:00", "end_time": "13:00"}]

    def setUp(self):
        self.provider = self.create_provider(email="dr.blocks@example.com", timezone="UTC")
        self.appointment_type = AppointmentType.objects.create(
            provider=self.provider, name="Follow-up", duration_minutes=60
        )
        self.patient = self.create_patient(email="blocks.patient@example.com")
        self.boundary_monday = next_monday(min_days_ahead=14)
        self.old_monday = self.boundary_monday - timedelta(days=7)

    def _put_schedule(self, windows, effective_from):
        response = self.put_json(
            "/scheduling/schedule", {"windows": windows, "effective_from": effective_from}
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def _slot_starts(self, date_from, date_to):
        response = self.client.get(
            "/scheduling/slots"
            f"?provider_id={self.provider.id}"
            f"&appointment_type_id={self.appointment_type.id}"
            f"&date_from={date_from.isoformat()}&date_to={date_to.isoformat()}"
        )
        self.assertEqual(response.status_code, 200, response.content)
        return [slot["start"] for slot in response.json()["slots"]]

    def _expected_starts(self, day, hours):
        return [f"{day.isoformat()}T{hour:02d}:00:00Z" for hour in hours]

    def test_multi_block_hours_produce_slots_only_inside_the_blocks(self):
        self.login_as(self.provider)
        self._put_schedule(self.OLD_WINDOWS, None)

        self.login_as(self.patient)
        starts = self._slot_starts(self.old_monday, self.old_monday)

        # Exactly the two blocks' worth of 60-minute slots -- in
        # particular, nothing in the 11:00-14:00 gap between them (the
        # 11:00 candidate can't fit before the block ends, and 12:00/13:00
        # fall in no window at all).
        self.assertEqual(
            starts, self._expected_starts(self.old_monday, [8, 9, 10, 14, 15, 16])
        )

    def test_a_deferred_change_switches_patient_slots_exactly_at_effective_from(self):
        self.login_as(self.provider)
        self._put_schedule(self.OLD_WINDOWS, None)

        body = self._put_schedule(self.NEW_WINDOWS, self.boundary_monday.isoformat())

        # The deferred save leaves the live generation untouched (the
        # multi-block hours stay live for near dates) and parks the new
        # picture as `pending` -- what the frontend banner renders from.
        self.assertIsNone(body["current"]["effective_from"])
        self.assertEqual(
            [(w["start_time"], w["end_time"]) for w in body["current"]["windows"]],
            [("08:00:00", "11:00:00"), ("14:00:00", "17:00:00")],
        )
        self.assertEqual(
            body["pending"]["effective_from"], self.boundary_monday.isoformat()
        )

        # One patient slot query spanning the boundary: the Monday before
        # `effective_from` still serves the old multi-block hours; the
        # boundary Monday itself serves only the new 10:00-13:00 hours.
        # Exact list equality also proves no other day in the range leaks
        # slots from either generation.
        self.login_as(self.patient)
        starts = self._slot_starts(self.old_monday, self.boundary_monday)

        self.assertEqual(
            starts,
            self._expected_starts(self.old_monday, [8, 9, 10, 14, 15, 16])
            + self._expected_starts(self.boundary_monday, [10, 11, 12]),
        )
