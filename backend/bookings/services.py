"""Booking-creation engine -- architecture.md §3 (the two-layer
double-booking guard) and §4 (auto-accept). `create_booking` is the single
write path `POST /bookings` (`bookings.views.BookingCreateView`) calls; it
assumes the caller has already resolved and authorized `patient`/
`provider`/`appointment_type` (same division of labor as
`scheduling.views.SlotsView`, which resolves `provider`/`appointment_type`
before ever calling `scheduling.slots.get_open_slots`).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction

from audit.services import record_audit_event
from scheduling.models import BlockedTime
from scheduling.slots import get_open_slots

from .exceptions import SlotNoLongerAvailable, SlotNotOpen
from .models import Booking


def _busy_intervals(provider, padded_start, padded_end):
    """`BlockedTime` rows ∪ other active `Booking` rows for `provider`
    overlapping `[padded_start, padded_end)` -- the same "any busy
    interval, regardless of source" shape `scheduling.views.SlotsView`
    already builds for `GET /scheduling/slots`, reused here so
    `_slot_is_currently_open` below checks the *exact* rules a patient's
    slot browse just showed them.
    """
    blocked = [
        (blocked.start, blocked.end)
        for blocked in BlockedTime.objects.filter(
            provider=provider, start__lt=padded_end, end__gt=padded_start
        )
    ]
    booked = [
        (booking.start_time, booking.end_time)
        for booking in Booking.objects.filter(
            provider=provider,
            status__in=Booking.ACTIVE_STATUSES,
            start_time__lt=padded_end,
            end_time__gt=padded_start,
        )
    ]
    return blocked + booked


def _slot_is_currently_open(provider, appointment_type, start_time, end_time):
    """This ticket's point 6 guard: a client can't turn an arbitrary
    `start_time` into a booking just because no `Booking` row happens to
    conflict with it yet -- it also has to be a slot `get_open_slots`
    would actually offer right now (within working hours, not blocked, not
    in the past). Reuses `get_open_slots` rather than re-deriving its
    rules, padded a day on each side exactly as `SlotsView` pads its own
    query (see that view's comment -- the widest gap between a UTC instant
    and a provider-local calendar date is under 24h for any real-world
    offset).
    """
    local_date = start_time.astimezone(ZoneInfo(provider.timezone)).date()
    date_from = local_date - timedelta(days=1)
    date_to = local_date + timedelta(days=1)
    padded_start = datetime.combine(date_from, time.min, tzinfo=dt_timezone.utc)
    padded_end = datetime.combine(date_to, time.max, tzinfo=dt_timezone.utc)

    slots = get_open_slots(
        provider,
        appointment_type,
        date_from,
        date_to,
        busy_intervals=_busy_intervals(provider, padded_start, padded_end),
    )
    return any(slot.start == start_time and slot.end == end_time for slot in slots)


def _confirm(booking):
    """The one hardcoded `requested` -> `confirmed` step this ticket needs
    (architecture.md §4's auto-accept rule) -- not a generic `transition()`
    function; TICKET-08 owns building the full allowed-transitions table.
    Only ever called once, immediately after creation, inside the same
    transaction as the insert.
    """
    booking.status = Booking.Status.CONFIRMED
    booking.save(update_fields=["status", "updated_at"])


def create_booking(*, patient, provider, appointment_type, start_time, idempotency_key=None):
    """Create, and immediately auto-confirm, one `Booking` -- or raise a
    `bookings.exceptions.BookingConflict` subclass the view turns into a
    clean 4xx (never a raw 500). `end_time` is always derived here from
    `appointment_type.duration_minutes`; it is never accepted as input.

    Order of checks inside the transaction, and why:

    1. Idempotency short-circuit -- an existing row for `idempotency_key`
       (if given) is returned as-is, before any conflict check runs. A
       retried/double-submitted request is not an error.
    2. Layer 1 -- `select_for_update()` locks any existing active `Booking`
       for `provider` overlapping the requested window; `SlotNoLongerAvailable`
       if one exists.
    3. Point 6 -- re-validates the slot is genuinely open right now (hours,
       blocked time, not in the past) via `get_open_slots`; `SlotNotOpen`
       if not. Deliberately runs *after* step 2: by this point there is no
       existing conflicting `Booking` row (step 2 would have already
       raised), so a "not open" result here can only mean hours/blocked/
       past -- bad input (400), not a race the request lost (409).
    4. Insert (status=`REQUESTED`), auto-confirm to `CONFIRMED`, and one
       audit entry -- all in the same transaction.

    Layer 2 backstop: `Booking.Meta`'s partial `UniqueConstraint` is
    unconditional -- it also catches the case Layer 1 *can't*: two brand
    -new bookings racing for a slot with no existing row yet to lock (an
    empty `select_for_update()` result takes no lock and blocks nothing).
    The resulting `IntegrityError` is caught here and re-raised as
    `SlotNoLongerAvailable`, except when it turns out to be a genuinely
    simultaneous double-submit of the *same* `idempotency_key` -- then the
    winner's row is returned instead, same as the short-circuit in step 1.
    """
    end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

    try:
        with transaction.atomic():
            if idempotency_key:
                existing = Booking.objects.filter(idempotency_key=idempotency_key).first()
                if existing is not None:
                    return existing

            conflicting = Booking.objects.select_for_update().filter(
                provider=provider,
                status__in=Booking.ACTIVE_STATUSES,
                start_time__lt=end_time,
                end_time__gt=start_time,
            )
            if conflicting.exists():
                raise SlotNoLongerAvailable()

            if not _slot_is_currently_open(provider, appointment_type, start_time, end_time):
                raise SlotNotOpen()

            booking = Booking.objects.create(
                provider=provider,
                patient=patient,
                appointment_type=appointment_type,
                start_time=start_time,
                end_time=end_time,
                status=Booking.Status.REQUESTED,
                idempotency_key=idempotency_key,
            )
            _confirm(booking)
            record_audit_event(
                actor=patient,
                action="create:booking",
                target_type="booking",
                target_id=booking.id,
                metadata={"provider_id": provider.id, "status": booking.status},
            )
            return booking
    except IntegrityError as exc:
        if idempotency_key:
            existing = Booking.objects.filter(idempotency_key=idempotency_key).first()
            if existing is not None:
                return existing
        raise SlotNoLongerAvailable() from exc
