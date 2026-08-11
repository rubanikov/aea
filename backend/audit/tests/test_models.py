from django.contrib.auth import get_user_model
from django.test import TestCase

from audit.models import AuditLog

User = get_user_model()


class AuditLogAppendOnlyTests(TestCase):
    """`AuditLog` is append-only by design: no `updated_at`, `timestamp`
    is set once by the DB and never touched again, and deleting the actor
    nulls the reference rather than cascading into the log itself."""

    def test_has_no_updated_at_field(self):
        field_names = {field.name for field in AuditLog._meta.get_fields()}

        self.assertNotIn("updated_at", field_names)

    def test_timestamp_is_set_automatically_on_creation(self):
        entry = AuditLog.objects.create(action="x", target_type="t", target_id="1")

        self.assertIsNotNone(entry.timestamp)
        self.assertTrue(AuditLog._meta.get_field("timestamp").auto_now_add)

    def test_deleting_the_actor_nulls_the_reference_instead_of_deleting_the_entry(self):
        actor = User.objects.create_user(email="deleteme@example.com", password="x")
        entry = AuditLog.objects.create(actor=actor, action="x", target_type="t", target_id="1")

        actor.delete()
        entry.refresh_from_db()

        self.assertIsNone(entry.actor)

    def test_actor_is_optional_for_system_initiated_entries(self):
        entry = AuditLog.objects.create(action="system:x", target_type="t", target_id="1")

        self.assertIsNone(entry.actor)
