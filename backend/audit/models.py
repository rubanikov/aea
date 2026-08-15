from django.conf import settings
from django.db import models


class AuditLogIsAppendOnly(Exception):
    """Raised by any code path that tries to mutate or delete an existing
    `AuditLog` row -- instance `save()` on a fetched row, instance
    `delete()`, or queryset `update()`/`delete()`. Makes append-only a
    model-level guarantee rather than just a convention, so a bulk cleanup
    script or a careless `.update()` in a fixture fails loudly instead of
    silently rewriting history. Deliberately *not* raised for the paths
    that don't rewrite history: the initial insert, and the `SET_NULL`
    `actor` clearing Django's deletion collector performs when a user
    account is deleted (that runs as a low-level `UpdateQuery`, not
    through this queryset -- see `AuditLogQuerySet`).
    """


class AuditLogQuerySet(models.QuerySet):
    """Blocks the bulk mutation paths `models.QuerySet` would otherwise
    hand out for free. Note this does *not* intercept Django's deletion
    collector nulling `actor` on user deletion -- that goes through
    `sql.UpdateQuery` directly, below the queryset layer -- which is
    exactly right: clearing a dangling actor reference isn't rewriting
    what happened, and `test_deleting_the_actor_nulls_the_reference...`
    in `audit/tests/test_models.py` pins that behavior.
    """

    def update(self, **kwargs):
        raise AuditLogIsAppendOnly("AuditLog rows cannot be updated; the log is append-only.")

    def delete(self):
        raise AuditLogIsAppendOnly("AuditLog rows cannot be deleted; the log is append-only.")


class AuditLog(models.Model):
    """Append-only record of "who did what to which resource, when" --
    the destination every PHI-touching write path logs to via
    `audit.services.record_audit_event`.

    `target_type` + `target_id` is a plain (string, string) pair rather
    than a real FK: this log has to reference bookings, availability
    records, users, and whatever else gets added later, and a single FK
    can only ever point at one model. `target_id` is a `CharField` (not
    `IntegerField`) so it isn't tied to today's `BigAutoField` primary
    keys if a future model uses a UUID or other non-integer key. `actor`
    is the one genuine FK here — it always means the same thing, the user
    who did the thing — and is nullable + `SET_NULL` so deleting an
    account can't cascade-delete the history that references it, and so
    system-initiated actions (e.g. the booking auto-confirm) have a
    legitimate way to log with no human actor.

    Append-only by design: no `updated_at`, no admin change/delete action
    (see `audit/admin.py`), no update/delete API route (see
    `audit/views.py` — a plain `ListAPIView`, which has no such route to
    begin with). The only intended write path is
    `audit.services.record_audit_event`; that's also *enforced* here, not
    just conventional: `save()` rejects anything but the initial insert,
    `delete()` always raises, and `AuditLogQuerySet` above blocks bulk
    `update()`/`delete()` — all with `AuditLogIsAppendOnly`. Below the
    ORM, migration `0002_append_only_trigger` installs a Postgres trigger
    that rejects any UPDATE/DELETE on the table (raw SQL, `psql`,
    anything), with the single carve-out of the SET_NULL `actor_id`
    clearing described above.
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_log_entries",
    )
    action = models.CharField(max_length=255)
    target_type = models.CharField(max_length=100)
    target_id = models.CharField(max_length=64)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    metadata = models.JSONField(null=True, blank=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ["-timestamp"]

    def save(self, *args, **kwargs):
        # `_state.adding` is True only for a row that hasn't been loaded
        # from (or previously saved to) the database -- i.e. the one write
        # this model permits, the initial insert.
        if not self._state.adding:
            raise AuditLogIsAppendOnly(
                "AuditLog rows cannot be modified after creation; the log is append-only."
            )
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AuditLogIsAppendOnly(
            "AuditLog rows cannot be deleted; the log is append-only."
        )

    def __str__(self):
        return f"{self.action} on {self.target_type}:{self.target_id} @ {self.timestamp}"
