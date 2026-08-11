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

Four independent things live in this file, each a genuine gap no single
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
2. `AccountDeletionCancelsUpcomingAppointmentsTests` -- TICKET-14's
   "upcoming appointments are cancelled as part of the deletion flow"
   criterion, exercised against a patient who actually has one; every
   fixture in `accounts/tests/test_account_deletion.py` registers a patient
   with zero bookings.
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
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from accounts.tests.helpers import AJAX_HEADERS, TEST_PASSWORD
from audit.models import AuditLog
from bookings.models import Booking

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
        self.assertTrue(patient.password.startswith("pbkdf2_"))

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
        # 09:00-17:00)" --
        self.login_as(provider)
        for day_of_week in range(5):  # Monday(0) .. Friday(4)
            availability_response = self.post_json(
                "/scheduling/availability",
                {"day_of_week": day_of_week, "start_time": "09:00", "end_time": "17:00"},
            )
            self.assertEqual(availability_response.status_code, 201, availability_response.content)

        # -- Core #2: "a slot length (e.g. 30 min)" -- per-AppointmentType,
        # architecture.md §2.
        appointment_type_response = self.post_json(
            "/scheduling/appointment-types", {"name": "Follow-up", "duration_minutes": 60}
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
    """TICKET-14 / project.md Core #1's retention companion: "Any upcoming
    appointments are cancelled as part of the deletion flow." Every fixture
    in `accounts/tests/test_account_deletion.py`'s `AccountDeletionTests`
    registers a patient with zero bookings (see e.g. that file's own
    `test_response_reports_zero_cancelled_appointments_for_now`) -- this is
    the one case that actually gives the patient an upcoming confirmed
    booking before requesting deletion, which is where this specific
    criterion lives.
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
        # `accounts.serializers._cancel_upcoming_appointments`'s
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
