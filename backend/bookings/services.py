"""Booking-creation (and, as of TICKET-10, rescheduling) engine --
architecture.md §3 (the two-layer double-booking guard) and §4
(auto-accept). `create_booking` is the single write path `POST /bookings`
(`bookings.views.BookingListCreateView`) calls; `reschedule_booking` is the
single write path `PATCH /bookings/<id>/reschedule`
(`bookings.views.BookingRescheduleView`) calls. Both assume the caller has
already resolved and authorized `patient`/`provider`/`appointment_type`
(same division of labor as `scheduling.views.SlotsView`, which resolves
`provider`/`appointment_type` before ever calling
`scheduling.slots.get_open_slots`), and both build on the same
`_book_open_slot` guard below -- one double-booking-guard implementation,
not two independently-maintained copies.
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
    abort (SQLSTATE 40P01). Deadlocks are a *designed-in* outcome of the
    exclusion constraints, not an outage: a GiST exclusion check runs
    *after* the index tuple is physically inserted, so two overlapping
    inserts racing (the mixed-duration shape -- a 60-minute 09:00 against
    a 30-minute 09:30, where no btree unique index conflicts first) can
    each insert, then each wait on the other's transaction; Postgres
    resolves the cycle by aborting one. The aborted request is, by
    construction, a booking attempt that overlapped a concurrent competing
    write -- a lost race, answered with the same 409 as an exclusion
    violation, never the exception handler's database-outage 503. Any
    other `OperationalError` (a real outage) is re-raised untouched.
    Django chains the driver's error as `__cause__`; psycopg 3 exposes
    the SQLSTATE as `.sqlstate`.
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
    """Layer 2: map a constraint rejection (partial unique index for an
    identical start, exclusion constraint for the general mixed-duration
    overlap) onto the matching 409. Postgres includes the constraint name
    in the error; a patient-axis collision is the patient's own conflicting
    appointment, not a lost race for the chair.
    """
    if any(name in str(exc) for name in _PATIENT_CONSTRAINTS):
        return PatientAlreadyBooked()
    return SlotNoLongerAvailable()


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


def _book_open_slot(
    *, patient, provider, appointment_type, start_time, end_time, idempotency_key=None
):
    """Layer 1 conflict check + point 6's "is this slot genuinely open
    right now" re-validation + insert + auto-confirm -- the reusable core
    of both `create_booking` and `reschedule_booking` (TICKET-10). Callers
    are responsible for running this inside their own `transaction.atomic()`
    block and for catching the `IntegrityError` Layer 2's partial
    `UniqueConstraint` can still raise (see both callers' docstrings).

    1. Layer 1 -- `select_for_update()` locks any existing active `Booking`
       for `provider` *or* `patient` overlapping `[start_time, end_time)`;
       `PatientAlreadyBooked` if the patient already occupies an
       overlapping window, `SlotNoLongerAvailable` if the provider's chair
       is taken.
    2. Point 6 -- re-validates the slot is genuinely open right now (hours,
       blocked time, not in the past) via `get_open_slots`; `SlotNotOpen`
       if not. Deliberately runs *after* step 1: by this point there is no
       existing conflicting `Booking` row (step 1 would have already
       raised), so a "not open" result here can only mean hours/blocked/
       past -- bad input (400), not a race the request lost (409).
    3. Insert (status=`REQUESTED`), then auto-confirm to `CONFIRMED` via
       `bookings.transitions.transition` (architecture.md §4's auto-accept
       rule -- `actor=None`, a system-initiated transition, per that
       function's convention) -- all in the same transaction.
    """
    conflicting = Booking.objects.select_for_update().filter(
        Q(provider=provider) | Q(patient=patient),
        status__in=Booking.ACTIVE_STATUSES,
        start_time__lt=end_time,
        end_time__gt=start_time,
    )
    _raise_if_slot_taken(conflicting, patient=patient)

    if not _slot_is_currently_open(provider, appointment_type, start_time, end_time):
        # Under Postgres's default READ COMMITTED isolation, the locked
        # query above and `_slot_is_currently_open`'s own (unlocked) read
        # are two separate statements, each with its own snapshot -- a
        # competing transaction can commit a genuinely conflicting Booking
        # in the gap between them, one that `conflicting` above didn't yet
        # see but the open-slot re-validation now does (as an "occupied"
        # busy interval, not as a `Booking` conflict specifically). Without
        # this re-check, that race loss would incorrectly surface as
        # `SlotNotOpen` (400, "bad input") instead of `SlotNoLongerAvailable`
        # (409, "you lost a race") -- the two guards diagnose the same
        # underlying fact, so re-querying for a Booking-specific conflict
        # here (inside the same transaction, so it observes anything that
        # slipped in since the first check) disambiguates them correctly.
        # A `SlotNotOpen` after this point is genuinely about hours/blocked
        # time/the past, not a lost race.
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
    """Create, and immediately auto-confirm, one `Booking` -- or raise a
    `bookings.exceptions.BookingConflict` subclass the view turns into a
    clean 4xx (never a raw 500). `end_time` is always derived here from
    `appointment_type.duration_minutes`; it is never accepted as input.

    Order of checks inside the transaction, and why:

    1. Idempotency short-circuit -- an existing row for `idempotency_key`
       (if given) is returned as-is, before any conflict check runs. A
       retried/double-submitted request is not an error. Scoped to
       `patient` (security-audit finding): the column is globally unique,
       so an unscoped lookup would hand any authenticated patient who
       replays *another* patient's key that other patient's booking,
       fully serialized. A cross-patient key collision instead falls
       through to the insert, hits the unique index, and surfaces as
       `IdempotencyKeyConflict` (409) via the recovery branch below.
    2. `_book_open_slot` -- Layer 1's `select_for_update()` conflict check,
       point 6's open-slot re-validation, then insert + auto-confirm (see
       that function's docstring for the exact ordering).
    3. `create:booking` audit entry -- a second, distinct fact ("this
       booking was created") from the `status:requested->confirmed` entry
       `_book_open_slot`'s `transition()` call already wrote, not a
       duplicate of it.

    Layer 2 backstop: `Booking.Meta`'s DB constraints are unconditional --
    they also catch the case Layer 1 *can't*: two brand-new bookings
    racing with no existing row yet to lock (an empty
    `select_for_update()` result takes no lock and blocks nothing). The
    partial `UniqueConstraint`s refuse an identical-start duplicate; the
    exclusion constraints refuse the mixed-duration shape the unique
    indexes can't see (a 60-minute 09:00 racing a 30-minute 09:30 --
    overlapping spans, different start times). The GiST version of that
    refusal can surface as a Postgres deadlock abort instead of a clean
    violation (see `_is_deadlock`) -- mapped to the same 409. The
    `IntegrityError` case is caught here and re-raised as
    `SlotNoLongerAvailable`, except when it turns out to be a genuinely
    simultaneous double-submit of the *same* `idempotency_key` -- then the
    winner's row is returned instead, same as the short-circuit in step 1.
    That recovery re-query is `patient`-scoped too: if it finds nothing but
    the key nonetheless exists, the key belongs to a different patient --
    a cross-patient collision, answered with `IdempotencyKeyConflict`
    rather than the other patient's booking.
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
        # A deadlock abort is the exclusion constraints' version of losing
        # the two-brand-new-rows race (see `_is_deadlock`). The idempotency
        # re-check mirrors the `IntegrityError` branch below, belt and
        # braces -- though a same-key double submit serializes at the
        # `idempotency_key` btree unique index before ever reaching the
        # GiST indexes, so a deadlocked retry is not an expected path.
        if idempotency_key:
            existing = Booking.objects.filter(
                idempotency_key=idempotency_key, patient=patient
            ).first()
            if existing is not None:
                return existing
        # Deliberately not `_conflict_from_integrity_error`: a deadlock
        # message carries lock/process context rather than one culpable
        # constraint name, so no axis attribution is reliable here.
        raise SlotNoLongerAvailable() from exc
    except IntegrityError as exc:
        if idempotency_key:
            existing = Booking.objects.filter(
                idempotency_key=idempotency_key, patient=patient
            ).first()
            if existing is not None:
                return existing
            if Booking.objects.filter(idempotency_key=idempotency_key).exists():
                # The key exists but not for *this* patient: a cross-patient
                # key collision (see the docstring above). Never return --
                # or even further inspect -- the other patient's row.
                raise IdempotencyKeyConflict() from exc
        raise _conflict_from_integrity_error(exc) from exc


def reschedule_booking(*, booking, actor, start_time):
    """Atomically move `booking` to a new `start_time` -- TICKET-10.
    `provider`/`appointment_type` are always taken from `booking` itself
    and never change; the caller only supplies the new `start_time` (see
    `bookings.views.BookingRescheduleView`'s docstring for why moving
    provider/appointment type is out of scope -- that's a cancel plus a
    fresh `POST /bookings`, not a reschedule). `end_time` is always
    re-derived from `appointment_type.duration_minutes`, exactly as
    `create_booking` does -- never accepted as input.

    One `transaction.atomic()` block, in this order:

    1. Re-fetch `booking` under `select_for_update()`. This serializes
       this call against any other concurrent transition on the *same*
       booking (another reschedule, a cancel, a provider status update,
       ...), so a second concurrent attempt on this exact booking sees
       this one's committed result (via step 3 below) rather than racing
       it -- the same "lock, then decide" discipline `_book_open_slot`
       uses for the *new* slot, applied here to the old one.
    2. `bookings.transitions.check_cancellation_notice(booking)` -- the
       *same* 24h-minimum-notice rule `transition()` applies to a plain
       cancel, checked against the *original* booking's `start_time`
       (this ticket's brief: "same notice-rule enforcement as cancel").
       Deliberately does not also hold the *new* target time to this rule
       -- a fresh `POST /bookings` has no such lead-time restriction
       (`scheduling.slots.get_open_slots` only ever excludes the past), so
       holding a reschedule's target to a stricter bar than a same-day
       booking would be is an inconsistency, not a real safety measure.
    3. `transition(booking, CANCELLED, actor=actor)` -- frees the old slot
       *before* the new one is booked, not after. This ordering matters,
       not just style: `_book_open_slot`'s conflict/open-slot checks (step
       4) don't know to exclude `booking`'s own row, so if the new target
       overlaps the *old* window at all (an entirely ordinary reschedule --
       "shift this 60-minute appointment 30 minutes later" -- shares half
       its window with itself) and the old booking were still `CONFIRMED`
       at that point, it would appear as its own conflicting busy interval
       and the reschedule would spuriously 409 against itself. Cancelling
       first removes `booking` from `Booking.ACTIVE_STATUSES` before step 4
       ever queries for conflicts, so only *other* bookings can conflict.
       Also the second, independent enforcement point for a booking that
       isn't reschedulable at all any more (already
       `cancelled`/`completed`/`no_show`: `InvalidTransition`) -- re-using
       `transition()`'s own legality table rather than duplicating it.
    4. `_book_open_slot` for the new `[start_time, end_time)` window -- the
       *exact* double-booking guard `create_booking` uses, reused rather
       than reimplemented. Raises `SlotNoLongerAvailable`/`SlotNotOpen` if
       the target isn't available, same as a fresh booking request against
       that slot would. If this raises, the whole transaction (including
       step 3's cancel, which already ran) rolls back -- Django's
       `atomic()` does not commit anything from an aborted block, so
       `booking` ends up exactly as it started from any observer outside
       this function, regardless of which step raised.
    5. One `reschedule:booking` audit entry connecting the two ids, so this
       reads as a single logical event rather than "a cancel that happened
       to be followed by a create."

    Any raise above rolls back the whole transaction -- a lost race for the
    new slot, a too-soon notice window, or an already-terminal booking all
    leave `booking` (and everything else) exactly as they were.

    Layer 2 backstop: same as `create_booking` -- an `IntegrityError` from
    the DB constraints (partial unique index or exclusion constraint; the
    case Layer 1 can't catch: two brand-new bookings racing with no
    existing row yet to lock) is caught and re-raised as
    `SlotNoLongerAvailable`.

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
        # the whole transaction -- including the already-run cancel of the
        # original booking -- rolled back with the abort.
        raise SlotNoLongerAvailable() from exc
    except IntegrityError as exc:
        raise _conflict_from_integrity_error(exc) from exc
