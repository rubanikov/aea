from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TestCase

from audit.models import AuditLog, AuditLogIsAppendOnly

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


class AuditLogAppendOnlyEnforcementTests(TestCase):
    """Append-only is enforced at the model layer, not just by convention
    (security-audit finding: nothing previously stopped code from calling
    `.update()`/`.delete()`): every mutation path -- instance save on an
    existing row, instance delete, queryset update, queryset delete --
    raises `AuditLogIsAppendOnly`. The initial insert (the one intended
    write, `audit.services.record_audit_event`) stays open, as does the
    deletion collector's `SET_NULL` actor clearing (pinned by
    `AuditLogAppendOnlyTests` above).
    """

    def setUp(self):
        self.entry = AuditLog.objects.create(action="x", target_type="t", target_id="1")

    def test_initial_insert_is_allowed(self):
        entry = AuditLog.objects.create(action="y", target_type="t", target_id="2")

        self.assertIsNotNone(entry.pk)

    def test_saving_an_existing_row_is_rejected(self):
        fetched = AuditLog.objects.get(pk=self.entry.pk)
        fetched.action = "rewritten"

        with self.assertRaises(AuditLogIsAppendOnly):
            fetched.save()

        fetched.refresh_from_db()
        self.assertEqual(fetched.action, "x")

    def test_instance_delete_is_rejected(self):
        with self.assertRaises(AuditLogIsAppendOnly):
            self.entry.delete()

        self.assertTrue(AuditLog.objects.filter(pk=self.entry.pk).exists())

    def test_queryset_update_is_rejected(self):
        with self.assertRaises(AuditLogIsAppendOnly):
            AuditLog.objects.filter(pk=self.entry.pk).update(action="rewritten")

        self.entry.refresh_from_db()
        self.assertEqual(self.entry.action, "x")

    def test_queryset_delete_is_rejected(self):
        with self.assertRaises(AuditLogIsAppendOnly):
            AuditLog.objects.all().delete()

        self.assertTrue(AuditLog.objects.filter(pk=self.entry.pk).exists())


class AuditLogDatabaseTriggerTests(TestCase):
    """The ORM guards above are bypassed by raw SQL, `psql`, or a
    low-level `sql.UpdateQuery`. `audit/migrations/0002_append_only_trigger`
    adds a Postgres trigger so the database itself refuses UPDATE/DELETE on
    `audit_auditlog` (SQLSTATE 23001 -> `IntegrityError`), with the single
    carve-out of the deletion collector's `actor_id -> NULL` SET_NULL.
    """

    def setUp(self):
        self.actor = User.objects.create_user(email="trigger@example.com", password="x")
        self.entry = AuditLog.objects.create(
            actor=self.actor, action="x", target_type="t", target_id="1"
        )

    def _execute(self, sql, params):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)

    def test_raw_sql_update_is_rejected_by_the_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._execute(
                "UPDATE audit_auditlog SET action = %s WHERE id = %s",
                ["rewritten", self.entry.pk],
            )

        self.entry.refresh_from_db()
        self.assertEqual(self.entry.action, "x")

    def test_raw_sql_delete_is_rejected_by_the_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._execute("DELETE FROM audit_auditlog WHERE id = %s", [self.entry.pk])

        self.assertTrue(AuditLog.objects.filter(pk=self.entry.pk).exists())

    def test_clearing_actor_alone_is_the_one_permitted_update(self):
        # Exactly what Django's SET_NULL emits when the actor row is deleted.
        self._execute(
            "UPDATE audit_auditlog SET actor_id = NULL WHERE id = %s", [self.entry.pk]
        )

        self.entry.refresh_from_db()
        self.assertIsNone(self.entry.actor)

    def test_clearing_actor_while_touching_another_column_is_rejected(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._execute(
                "UPDATE audit_auditlog SET actor_id = NULL, action = %s WHERE id = %s",
                ["rewritten", self.entry.pk],
            )

        self.entry.refresh_from_db()
        self.assertEqual(self.entry.action, "x")
        self.assertEqual(self.entry.actor, self.actor)
