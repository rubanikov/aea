"""Booking creation and rescheduling -- the two-layer double-booking guard
(architecture.md §3) plus auto-accept (§4). `create_booking` is the single
write path for `POST /bookings`; `reschedule_booking` is the single write
path for `PATCH /bookings/<id>/reschedule`. Both assume the caller has
already resolved and authorized `patient`/`provider`/`appointment_type`,
and both build on `_book_open_slot` below so there is one double-booking
guard, not two independently maintained copies.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Q

from audit.services import record_audit_event
from scheduling.models import BlockedTime
from scheduling.slots import get_open_slots

from .exceptions import (
    IdempotencyKeyConflict,
    PatientAlreadyBooked,
    SlotNoLongerAvailable,
    SlotNotOpen,
)
from .models import Booking
from .transitions import check_cancellation_notice, transition

# The two patient-axis constraint names (exact-start unique index and the
# general overlap exclusion constraint -- see `Booking.Meta.constraints`):
# a rejection naming either means the *patient's own* schedule conflicted,
# not a lost race for the provider's chair.
_PATIENT_CONSTRAINTS = (
    "unique_active_booking_per_patient_slot",
    "no_overlapping_active_booking_per_patient",
)

_DEADLOCK_SQLSTATE = "40P01"


def _is_deadlock(exc):
    """Whether a `django.db.OperationalError` wraps Postgres's deadlock
    abort (SQLSTATE 40P01). Deadlocks are a designed-in outcome of the
    exclusion constraints, not an outage: a GiST exclusion check runs
    *after* the index tuple is inserted, so two overlapping inserts racing
    (e.g. a 60-minute 09:00 booking against a 30-minute 09:30 one, where
    no btree unique index conflicts first) can both insert, then each wait
    on the other -- Postgres resolves the cycle by aborting one side. That
    abort is, by construction, a lost race for a conflicting slot, so it
    gets the same 409 as an exclusion violation rather than a 503. Any
    other `OperationalError` is a real outage and is re-raised untouched.
    Django exposes the driver's SQLSTATE as `exc.__cause__.sqlstate`.
    """
    return getattr(exc.__cause__, "sqlstate", None) == _DEADLOCK_SQLSTATE


def _raise_if_slot_taken(conflicting, *, patient):
    """Raise the matching 409 if `conflicting` (a locked Booking queryset)
    already overlaps this window for the provider or the patient. No-op
    when the queryset is empty -- the caller proceeds to insert.
    """
    if not conflicting.exists():
        return
    if conflicting.filter(patient=patient).exists():
        raise PatientAlreadyBooked()
    raise SlotNoLongerAvailable()


def _conflict_from_integrity_error(exc):
    """Map a constraint rejection (partial unique index for an identical
    start, exclusion constraint for the general mixed-duration overlap)
    onto the matching 409. Postgres includes the constraint name in the
    error; a patient-axis collision is the patient's own conflicting
    appointment, not a lost race for the chair.
    """
    if any(name in str(exc) for name in _PATIENT_CONSTRAINTS):
        return PatientAlreadyBooked()
    return SlotNoLongerAvailable()


def _busy_intervals(provider, padded_start, padded_end):
    """`BlockedTime` rows plus other active `Booking` rows for `provider`
    overlapping `[padded_start, padded_end)` -- the same "any busy
    interval, regardless of source" shape `scheduling.views.SlotsView`
    builds for `GET /scheduling/slots`, reused here so
    `_slot_is_currently_open` below checks the exact rules a patient's
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
    """Whether `get_open_slots` would actually offer `[start_time, end_time)`
    right now (within working hours, not blocked, not in the past) -- a
    client can't turn an arbitrary `start_time` into a booking just
    because no `Booking` row happens to conflict with it yet. Padded a day
    on each side exactly as `SlotsView` pads its own query (the widest gap
    between a UTC instant and a provider-local calendar date is under 24h
    for any real-world offset).
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


def _book_open_slot(
    *, patient, provider, appointment_type, start_time, end_time, idempotency_key=None
):
    """Layer 1 conflict check + open-slot re-validation + insert +
    auto-confirm -- the reusable core of both `create_booking` and
    `reschedule_booking`. Callers must run this inside their own
    `transaction.atomic()` block and catch the `IntegrityError` Layer 2's
    partial `UniqueConstraint` can still raise.

    The open-slot re-validation (hours, blocked time, not in the past)
    runs *after* the `select_for_update()` conflict check, not before: by
    then any existing conflicting `Booking` row would already have
    raised, so a "not open" result here can only mean hours/blocked/past
    -- bad input (400), not a lost race (409).

    Auto-confirms the new booking straight to `CONFIRMED`
    (architecture.md §4's auto-accept rule) via `bookings.transitions
    .transition`, `actor=None` for the system-initiated step.
    """
    conflicting = Booking.objects.select_for_update().filter(
        Q(provider=provider) | Q(patient=patient),
        status__in=Booking.ACTIVE_STATUSES,
        start_time__lt=end_time,
        end_time__gt=start_time,
    )
    _raise_if_slot_taken(conflicting, patient=patient)

    if not _slot_is_currently_open(provider, appointment_type, start_time, end_time):
        # READ COMMITTED means the locked query above and this unlocked
        # open-slot read are separate snapshots -- a competing transaction
        # can commit a conflicting Booking in the gap between them, which
        # would otherwise surface as SlotNotOpen (400) instead of
        # SlotNoLongerAvailable (409, "you lost a race"). Re-checking
        # here, inside the same transaction, catches that and
        # reclassifies it correctly; a SlotNotOpen past this point is
        # genuinely about hours/blocked time/the past.
        _raise_if_slot_taken(conflicting, patient=patient)
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
    transition(booking, Booking.Status.CONFIRMED, actor=None)
    return booking


def create_booking(*, patient, provider, appointment_type, start_time, idempotency_key=None):
    """Create, and immediately auto-confirm, one `Booking`, or raise a
    `bookings.exceptions.BookingConflict` subclass the view turns into a
    clean 4xx. `end_time` is always derived from
    `appointment_type.duration_minutes`, never accepted as input.

    An `idempotency_key` short-circuits before any conflict check: an
    existing row for that key (scoped to `patient` -- the column is
    globally unique, so an unscoped lookup would hand a replayed key from
    another patient their booking) is returned as-is. A cross-patient key
    collision instead falls through to the insert, hits the unique index,
    and surfaces as `IdempotencyKeyConflict` below.

    `_book_open_slot` does the actual conflict check, re-validation,
    insert, and auto-confirm (see its docstring). A `create:booking`
    audit entry is written after, distinct from the
    `status:requested->confirmed` entry `_book_open_slot`'s `transition()`
    call already wrote.

    Layer 2 backstop: an `IntegrityError` from `Booking.Meta`'s DB
    constraints (see there for what they catch and why -- the case Layer
    1 can't, two brand-new bookings racing with nothing yet to lock) is
    re-raised as `SlotNoLongerAvailable`, unless it turns out to be a
    genuinely simultaneous double-submit of the same `idempotency_key`,
    in which case the winner's row is returned instead (same recovery as
    the short-circuit above, same patient-scoping to avoid handing back a
    cross-patient collision as `IdempotencyKeyConflict`). A Postgres
    deadlock abort (see `_is_deadlock`) gets the same treatment.
    """
    end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

    try:
        with transaction.atomic():
            if idempotency_key:
                existing = Booking.objects.filter(
                    idempotency_key=idempotency_key, patient=patient
                ).first()
                if existing is not None:
                    return existing

            booking = _book_open_slot(
                patient=patient,
                provider=provider,
                appointment_type=appointment_type,
                start_time=start_time,
                end_time=end_time,
                idempotency_key=idempotency_key,
            )
            record_audit_event(
                actor=patient,
                action="create:booking",
                target_type="booking",
                target_id=booking.id,
                metadata={"provider_id": provider.id, "status": booking.status},
            )
            return booking
    except OperationalError as exc:
        if not _is_deadlock(exc):
            raise
        # Belt-and-braces: a same-key double submit serializes at the
        # idempotency_key unique index before reaching the GiST indexes,
        # so a deadlocked retry isn't an expected path, but check anyway.
        if idempotency_key:
            existing = Booking.objects.filter(
                idempotency_key=idempotency_key, patient=patient
            ).first()
            if existing is not None:
                return existing
        # Not `_conflict_from_integrity_error`: a deadlock message carries
        # lock/process context, not one culpable constraint name.
        raise SlotNoLongerAvailable() from exc
    except IntegrityError as exc:
        if idempotency_key:
            existing = Booking.objects.filter(
                idempotency_key=idempotency_key, patient=patient
            ).first()
            if existing is not None:
                return existing
            if Booking.objects.filter(idempotency_key=idempotency_key).exists():
                # Key exists for a different patient -- never return or
                # inspect that patient's row.
                raise IdempotencyKeyConflict() from exc
        raise _conflict_from_integrity_error(exc) from exc


def reschedule_booking(*, booking, actor, start_time):
    """Atomically move `booking` to a new `start_time`. `provider` and
    `appointment_type` are always taken from `booking` itself and never
    change (see `bookings.views.BookingRescheduleView` for why moving
    either is out of scope); `end_time` is re-derived from
    `appointment_type.duration_minutes`, same as `create_booking`.

    Inside one `transaction.atomic()` block:

    1. Re-fetch `booking` under `select_for_update()`, serializing this
       call against any other concurrent transition on the same booking.
    2. `check_cancellation_notice(booking)` -- the same 24h rule
       `transition()` applies to a plain cancel, checked against the
       *original* start_time only. The new target time is deliberately
       not held to this rule: a fresh `POST /bookings` has no such
       lead-time restriction, so holding a reschedule to a stricter bar
       than an equivalent same-day booking would be an inconsistency.
    3. `transition(booking, CANCELLED, actor=actor)` -- frees the old slot
       *before* the new one is booked. This ordering matters:
       `_book_open_slot`'s checks (step 4) don't know to exclude
       `booking`'s own row, so an ordinary reschedule that overlaps its
       own old window (e.g. shifting a 60-minute appointment 30 minutes
       later) would spuriously conflict with itself if the old booking
       were still active. Cancelling first also doubles as the
       enforcement point for a booking that isn't reschedulable at all
       any more (`InvalidTransition` for an already-terminal one).
    4. `_book_open_slot` for the new window -- the same guard
       `create_booking` uses. Raises `SlotNoLongerAvailable`/`SlotNotOpen`
       if the target isn't available; either raise rolls back the whole
       transaction, including step 3's cancel, leaving `booking` exactly
       as it started.
    5. One `reschedule:booking` audit entry connecting the two ids, so
       this reads as a single event rather than a cancel that happened to
       be followed by a create.

    Layer 2 backstop: same as `create_booking` -- an `IntegrityError` from
    the DB constraints is caught and re-raised as `SlotNoLongerAvailable`.

    Returns the new, already-confirmed `Booking`.
    """
    provider = booking.provider
    patient = booking.patient
    appointment_type = booking.appointment_type
    end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

    try:
        with transaction.atomic():
            booking = Booking.objects.select_for_update().get(pk=booking.pk)

            check_cancellation_notice(booking)

            transition(booking, Booking.Status.CANCELLED, actor=actor)

            new_booking = _book_open_slot(
                patient=patient,
                provider=provider,
                appointment_type=appointment_type,
                start_time=start_time,
                end_time=end_time,
            )

            record_audit_event(
                actor=actor,
                action="reschedule:booking",
                target_type="booking",
                target_id=new_booking.id,
                metadata={"old_booking_id": booking.id, "new_booking_id": new_booking.id},
            )
            return new_booking
    except OperationalError as exc:
        if not _is_deadlock(exc):
            raise
        # Same lost-race mapping as `create_booking` (see `_is_deadlock`);
        # the whole transaction, including the already-run cancel of the
        # original booking, rolled back with the abort.
        raise SlotNoLongerAvailable() from exc
    except IntegrityError as exc:
        raise _conflict_from_integrity_error(exc) from exc
