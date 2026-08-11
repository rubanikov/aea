from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only record of "who did what to which resource, when" —
    TICKET-03's audit trail, and the destination every later PHI-touching
    ticket (TICKET-04 onward) is expected to write to via
    `audit.services.record_audit_event`.

    `target_type` + `target_id` is a plain (string, string) pair rather
    than a real FK: this log has to reference bookings, availability
    records, users, and whatever else future tickets add, and a single FK
    can only ever point at one model. `target_id` is a `CharField` (not
    `IntegerField`) so it isn't tied to today's `BigAutoField` primary keys
    if a future model uses a UUID or other non-integer key. `actor` is the
    one genuine FK here — it always means the same thing, the user who did
    the thing — and is nullable + `SET_NULL` so deleting an account
    (TICKET-14) can't cascade-delete the history that references it, and
    so system-initiated actions (e.g. TICKET-07's auto-confirm) have a
    legitimate way to log with no human actor.

    Append-only by design: no `updated_at`, no admin change/delete action
    (see `audit/admin.py`), no update/delete API route (see
    `audit/views.py` — a plain `ListAPIView`, which has no such route to
    begin with). The only intended write path is
    `audit.services.record_audit_event`.
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

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.action} on {self.target_type}:{self.target_id} @ {self.timestamp}"
