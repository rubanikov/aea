from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase

from audit.models import AuditLog
from audit.services import record_audit_event

User = get_user_model()


class RecordAuditEventTests(TestCase):
    def test_creates_an_audit_log_row_with_the_given_fields(self):
        actor = User.objects.create_user(email="actor@example.com", password="x")

        record_audit_event(
            actor=actor,
            action="status:confirmed->completed",
            target_type="booking",
            target_id=42,
            metadata={"previous_status": "confirmed"},
        )

        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, actor)
        self.assertEqual(entry.action, "status:confirmed->completed")
        self.assertEqual(entry.target_type, "booking")
        self.assertEqual(entry.target_id, "42")
        self.assertEqual(entry.metadata, {"previous_status": "confirmed"})
        self.assertIsNotNone(entry.timestamp)

    def test_allows_a_null_actor_for_system_initiated_events(self):
        record_audit_event(
            actor=None, action="booking:auto_confirmed", target_type="booking", target_id=7
        )

        entry = AuditLog.objects.get()
        self.assertIsNone(entry.actor)

    def test_casts_target_id_to_a_string_regardless_of_input_type(self):
        record_audit_event(actor=None, action="x", target_type="booking", target_id=7)

        entry = AuditLog.objects.get()
        self.assertEqual(entry.target_id, "7")
        self.assertIsInstance(entry.target_id, str)

    def test_metadata_defaults_to_none_when_omitted(self):
        record_audit_event(actor=None, action="x", target_type="booking", target_id=1)

        entry = AuditLog.objects.get()
        self.assertIsNone(entry.metadata)

    def test_participates_in_the_callers_transaction_instead_of_committing_separately(self):
        """A `record_audit_event` call inside an `atomic()` block that
        later raises rolls back together with everything else in that
        block -- proof it's the *same* transaction as the change it
        records, not a separate best-effort write (this ticket's explicit
        requirement, matching architecture.md §3's booking-creation
        pattern)."""

        class Boom(Exception):
            pass

        with self.assertRaises(Boom):
            with transaction.atomic():
                record_audit_event(
                    actor=None, action="would-be-rolled-back", target_type="booking", target_id=1
                )
                raise Boom()

        self.assertEqual(AuditLog.objects.count(), 0)


class NoPHIInRealisticCallsTests(TestCase):
    """`action`/`metadata` are free text -- this can't be enforced at the
    DB layer (this ticket's own note) -- so this test is a runnable
    example of the intended calling convention every later ticket's call
    sites should follow: reference the acting user and the resource by
    id, never by the values that just came off a `User`/PHI-bearing
    instance. Matches architecture.md §6's "no PHI in logs" and this
    ticket's "log entries reference IDs only" accept criterion."""

    def test_a_realistic_status_transition_call_carries_no_name_or_email(self):
        patient = User.objects.create_user(
            email="realpatient@example.com",
            password="x",
            name="Real Patient",
            role=User.Role.PATIENT,
        )
        booking_id = 123

        record_audit_event(
            actor=patient,
            action="status:requested->confirmed",
            target_type="booking",
            target_id=booking_id,
            metadata={"previous_status": "requested"},
        )

        entry = AuditLog.objects.get()
        self.assertNotIn(patient.email, entry.action)
        self.assertNotIn(patient.name, entry.action)
        self.assertNotIn(patient.email, str(entry.metadata))
        self.assertNotIn(patient.name, str(entry.metadata))
        self.assertEqual(entry.target_id, str(booking_id))
