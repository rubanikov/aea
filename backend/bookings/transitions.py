"""The single write path for every `Booking.status` change -- architecture.md
§4's closed enum + explicit transition guard. `bookings.services.create_booking`
routes its own `requested` -> `confirmed` auto-accept step through `transition()`
too (see that module), so this is the *only* place `Booking.status` is ever
assigned outside a migration -- no ad-hoc status writes anywhere else.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from audit.services import record_audit_event

from .exceptions import CancellationNoticeTooShort, InvalidTransition, NoShowBeforeStartTime
from .models import Booking

# TICKET-09's brief: "no cancel < 24h before start." architecture.md
# doesn't mandate a different value, so this is the one hardcoded minimum
# -notice window the whole app enforces -- see `CancellationNoticeTooShort`.
CANCELLATION_MIN_NOTICE = timedelta(hours=24)

# Exactly architecture.md §4's table. Every status not present as a value
# anywhere on the right maps to "terminal" -- COMPLETED/CANCELLED/NO_SHOW's
# empty sets are what make a transition *out* of them rejected rather than
# silently ignored.
ALLOWED_TRANSITIONS = {
    Booking.Status.REQUESTED: {Booking.Status.CONFIRMED, Booking.Status.CANCELLED},
    Booking.Status.CONFIRMED: {
        Booking.Status.COMPLETED,
        Booking.Status.CANCELLED,
        Booking.Status.NO_SHOW,
    },
    Booking.Status.COMPLETED: set(),
    Booking.Status.CANCELLED: set(),
    Booking.Status.NO_SHOW: set(),
}


def check_cancellation_notice(booking):
    """Raise `CancellationNoticeTooShort` if `booking.start_time` is less
    than `CANCELLATION_MIN_NOTICE` away from real "now" -- the one place
    this comparison is written, so `CANCELLATION_MIN_NOTICE` never becomes
    two independently-maintained checks. `transition()` calls this for
    every `-> CANCELLED` transition (see below); `bookings.services
    .reschedule_booking` (TICKET-10) calls it too, directly, against the
    *original* booking, before it even attempts the new slot -- "same
    notice-rule enforcement as cancel," reused rather than reimplemented.
    """
    if booking.start_time - timezone.now() < CANCELLATION_MIN_NOTICE:
        raise CancellationNoticeTooShort()


def transition(booking, new_status, *, actor, enforce_notice=True, cancellation_reason=None):
    """Move `booking.status` to `new_status`, writing the status change and
    its audit entry atomically, or raise without touching either:

    - `InvalidTransition` if `new_status` isn't reachable from the
      booking's current status per `ALLOWED_TRANSITIONS` above.
    - `NoShowBeforeStartTime` if `new_status` is `NO_SHOW` and
      `booking.start_time` hasn't passed yet, compared against real "now"
      in UTC (this ticket's brief) -- checked only *after* the table
      lookup above confirms `confirmed -> no_show` is otherwise legal, so
      a booking that isn't even `confirmed` gets the generic
      `InvalidTransition` instead.
    - `CancellationNoticeTooShort` (TICKET-09) if `new_status` is
      `CANCELLED` and `booking.start_time` is less than
      `CANCELLATION_MIN_NOTICE` away from real "now" -- same "checked only
      after the table lookup confirms the transition is otherwise legal"
      ordering as the `NO_SHOW` rule above, and same "regardless of actor"
      scope: this doesn't distinguish a patient's own cancellation from a
      provider's or an admin's.

    `actor` is required and explicit at every call site (never defaulted)
    -- pass `None` for a system-initiated transition (e.g. TICKET-07's
    auto-confirm inside `create_booking`), matching
    `audit.services.record_audit_event`'s own convention.

    `enforce_notice` defaults to `True`, so every ordinary caller (a
    patient's own cancel, a provider's status update, a reschedule's
    implicit cancel) keeps the 24h rule exactly as before. The one caller
    that passes `False` is `accounts.serializers._cancel_upcoming_appointments`
    (TICKET-14's account-deletion flow): the patient has asked to delete
    their whole account, not to cancel this one booking against the
    notice rule -- there is no "too late to cancel" left to protect once
    the account itself is going away, so that single call site
    deliberately skips this check rather than blocking deletion (or
    leaving a stray active booking behind) on a rule that exists to
    protect the *booking*, not the account-deletion flow. No other call
    site should ever pass `False`.

    `cancellation_reason` (doctor-cancel-reason-notify ticket 01): the
    provider's written reason, already validated by
    `BookingStatusUpdateSerializer` (non-blank, <= 500 chars, only ever
    present for a `-> CANCELLED` transition). Written to
    `Booking.cancellation_reason` in the *same* `save()` as the status
    change, so the two can never disagree. Every guard above runs first
    and unchanged -- a rejected transition leaves the stored reason
    exactly as it was. The default `None` means "leave the field alone,"
    which is what every cancel path *other* than the provider status
    endpoint (patient self-cancel, reschedule's implicit cancel, account
    deletion) passes implicitly, keeping their bookings' reasons `""`.

    Returns the same `booking` instance, saved and with `.status` already
    updated.
    """
    current_status = booking.status
    if new_status not in ALLOWED_TRANSITIONS[current_status]:
        raise InvalidTransition(current_status, new_status)

    if new_status == Booking.Status.NO_SHOW and booking.start_time > timezone.now():
        raise NoShowBeforeStartTime()

    if new_status == Booking.Status.CANCELLED and enforce_notice:
        check_cancellation_notice(booking)

    with transaction.atomic():
        booking.status = new_status
        if cancellation_reason is not None:
            booking.cancellation_reason = cancellation_reason
        booking.save(update_fields=["status", "cancellation_reason", "updated_at"])
        record_audit_event(
            actor=actor,
            action=f"status:{current_status}->{new_status}",
            target_type="booking",
            target_id=booking.id,
            # Deliberately records *who* (by role), never the reason text:
            # audit metadata is identifiers/status values only, never free
            # text or contact details (see `record_audit_event`'s docstring;
            # architecture.md §6, "no PHI in logs"). The reason lives on the
            # Booking row -- its absence here is intentional, not an
            # oversight.
            metadata={"initiated_by_role": actor.role if actor else "system"},
        )
    return booking
