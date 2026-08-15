"""Enforce the audit log's append-only rule in Postgres, not just in the ORM.

`AuditLog.save()`/`delete()` and `AuditLogQuerySet` already refuse mutation
(`audit/models.py`), but those guards only cover code that goes through the
ORM. A raw `cursor.execute("UPDATE audit_auditlog ...")`, a `psql` session,
or a bulk `sql.UpdateQuery` bypasses them. This trigger closes that gap:
any UPDATE or DELETE on `audit_auditlog` raises a `restrict_violation`
(SQLSTATE 23001), which psycopg surfaces as `IntegrityError`.

The one sanctioned UPDATE is the `SET_NULL` Django's deletion collector
runs on `actor_id` when a user row is hard-deleted -- clearing a dangling
actor reference isn't rewriting what happened (see `AuditLogIsAppendOnly`'s
docstring). The trigger allows exactly that shape: `actor_id` going from
non-null to null with every other column byte-identical.

TRUNCATE is deliberately not blocked: it fires no row-level trigger, and
Django's `TransactionTestCase`/`flush` rely on it.
"""

from django.db import migrations

CREATE_SQL = """
CREATE OR REPLACE FUNCTION audit_auditlog_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_auditlog is append-only: DELETE is not permitted'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'audit_auditlog is append-only: UPDATE is not permitted'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_auditlog_append_only
    BEFORE UPDATE OR DELETE ON audit_auditlog
    FOR EACH ROW EXECUTE FUNCTION audit_auditlog_append_only();
"""

DROP_SQL = """
DROP TRIGGER IF EXISTS audit_auditlog_append_only ON audit_auditlog;
DROP FUNCTION IF EXISTS audit_auditlog_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(CREATE_SQL, reverse_sql=DROP_SQL),
    ]
