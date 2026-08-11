from .models import AuditLog


def record_audit_event(actor, action, target_type, target_id, metadata=None):
    """Write one append-only `AuditLog` row.

    Deliberately a plain synchronous `AuditLog.objects.create(...)` — no
    queue, no `transaction.on_commit`, no separate connection — so calling
    it from inside a `transaction.atomic()` block (architecture.md §3's
    booking-creation pattern) makes the audit write part of the *same*
    transaction as the change it records: both commit together, or both
    roll back together. Do not wrap this in its own `atomic()` block or
    defer it with `on_commit` — that would break exactly the guarantee
    this function exists to provide.

    `action`/`metadata` are free text/JSON by design (this isn't a closed
    enum — see TICKET-03), but the calling convention is IDs only: pass
    `target_id=booking.id`, never `target_id=patient.name`, and keep
    `metadata` to other identifiers/status values, never names, DOB, or
    contact details (see architecture.md §6, "no PHI in logs").

    `actor=None` is a valid, intentional call for system-initiated actions
    (e.g. TICKET-07's auto-confirm) — it is not an error case.
    """
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        metadata=metadata,
    )
