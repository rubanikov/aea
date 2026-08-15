"""Account-lifecycle operations that touch more than one table.

`bookings` already imports from `accounts` at module level (its permission
classes and models reference `AUTH_USER_MODEL`), so the `bookings` imports
here are function-local to avoid the `accounts -> bookings -> accounts`
cycle. Same shape `scheduling.views` uses for its read-only `Booking` import.
"""

from django.db import transaction
from django.utils import timezone as django_timezone

from audit.services import record_audit_event


def _cancel_upcoming_appointments(user):
    """Cancels every upcoming, still-active `Booking` owned by `user` and
    returns the count.

    `enforce_notice=False` on the `transition()` call: the 24h
    minimum-notice rule exists to stop a *booking* being cancelled out
    from under someone too close to its start time -- it is not meant to
    block a patient from deleting their *entire account* just because one
    of their own upcoming bookings happens to fall inside that window.
    See `bookings.transitions.transition`'s docstring for this being the
    one sanctioned caller of that bypass.
    """
    from bookings.models import Booking
    from bookings.transitions import transition

    upcoming_bookings = Booking.objects.filter(
        patient=user,
        status__in=Booking.ACTIVE_STATUSES,
        start_time__gte=django_timezone.now(),
    )
    cancelled_count = 0
    for booking in upcoming_bookings:
        transition(booking, Booking.Status.CANCELLED, actor=user, enforce_notice=False)
        cancelled_count += 1
    return cancelled_count


@transaction.atomic
def delete_account(user):
    """Scrubs `user`'s PHI in place, deactivates the account, and cancels
    its upcoming appointments -- all or nothing.

    Runs in one transaction on purpose: without it, a failure part-way
    through (say, the third of five cancellations raising) would leave an
    audit row saying "deletion requested", two bookings cancelled, and a
    still-active account with its name and email intact. Rolling the whole
    thing back means the patient can simply retry.

    The row is never hard-deleted so `AuditLog.actor` keeps resolving by
    id; `deleted_at` is the tombstone (see `accounts.models.User`).

    Returns the number of appointments cancelled, which the endpoint
    surfaces as `cancelled_appointments_count`.
    """
    # Logged while the actor's own identifying fields are still intact --
    # the entry itself only ever references `user.id`, which stays valid
    # after the scrub below.
    record_audit_event(
        actor=user,
        action="account:deletion_requested",
        target_type="user",
        target_id=user.id,
        metadata={"role": user.role},
    )
    cancelled_count = _cancel_upcoming_appointments(user)

    user.name = ""
    user.phone = ""
    user.sms_carrier = ""
    user.email = f"deleted-user-{user.id}@deleted.invalid"
    user.is_active = False
    user.deleted_at = django_timezone.now()
    user.set_unusable_password()
    user.save()

    return cancelled_count
