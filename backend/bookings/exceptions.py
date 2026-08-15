"""Domain-level failures `bookings.services.create_booking` and
`bookings.transitions.transition` raise instead of letting a raw DB
exception (or a silent wrong success) reach the view. `bookings.views`
catches these and turns each into a specific, clean 4xx.
"""


class BookingConflict(Exception):
    """Base class for a booking creation request that cannot proceed."""


class SlotNoLongerAvailable(BookingConflict):
    """Someone else already holds this exact provider+slot: either an
    active `Booking` row Layer 1's `select_for_update` query found, or the
    DB's partial `UniqueConstraint` rejected the insert (Layer 2) --
    architecture.md §3. Maps to `409 Conflict` -- the slot was valid, the
    request lost a race for it.
    """

    def __init__(self, message="This slot is no longer available."):
        super().__init__(message)


class PatientAlreadyBooked(SlotNoLongerAvailable):
    """The requesting patient already has an active booking overlapping
    this window (possibly with a different provider). Same 409 as a lost
    race for the provider's chair -- the slot isn't takeable -- but a
    distinct message so the UI can say "you already have an appointment"
    rather than "someone else just booked it."
    """

    def __init__(self, message="You already have an appointment that overlaps this time."):
        super().__init__(message)


class IdempotencyKeyConflict(BookingConflict):
    """The submitted `Idempotency-Key` already belongs to a *different*
    patient's booking (the column is globally unique -- see
    `Booking.idempotency_key`). Distinct from the same-patient case, which
    is the intended retry and returns the existing booking: replaying
    someone else's key must never serialize their booking back (a PHI
    leak) and must map to a clean `409 Conflict`, never a 500. The generic
    message deliberately confirms nothing about the other booking's
    existence beyond the key collision itself.
    """

    def __init__(self, message="This idempotency key is already in use."):
        super().__init__(message)


class SlotNotOpen(BookingConflict):
    """The requested slot was never bookable to begin with -- outside the
    provider's working hours, inside a blocked range, or in the past.
    Maps to `400 Bad Request`, distinct from `SlotNoLongerAvailable`'s
    `409`: this is invalid input, not a race the request lost.
    """

    def __init__(self, message="This slot is not currently available for booking."):
        super().__init__(message)


class TransitionError(Exception):
    """Base class for a `bookings.transitions.transition()` call that
    cannot proceed (architecture.md §4). Maps to `400 Bad Request` at the
    view layer -- never a 500, and never a silent no-op.
    """


class InvalidTransition(TransitionError):
    """`new_status` is not reachable from `booking.status` per
    `bookings.transitions.ALLOWED_TRANSITIONS` -- e.g. `cancelled` ->
    `completed`, or any transition attempted out of a terminal state
    (`completed`/`cancelled`/`no_show` all map to an empty allowed set).
    """

    def __init__(self, current_status, new_status):
        self.current_status = current_status
        self.new_status = new_status
        super().__init__(
            f"Cannot transition a booking from '{current_status}' to '{new_status}'."
        )


class NoShowBeforeStartTime(TransitionError):
    """`confirmed` -> `no_show` *is* in `ALLOWED_TRANSITIONS` -- this is a
    narrower, distinct rejection from `InvalidTransition`: the transition
    itself is legal, it just isn't legal *yet*, because
    `booking.start_time` hasn't passed.
    """

    def __init__(
        self, message="Cannot mark a booking as no-show before its start time has passed."
    ):
        super().__init__(message)


class CancellationNoticeTooShort(TransitionError):
    """`requested`/`confirmed` -> `cancelled` *is* in `ALLOWED_TRANSITIONS`
    -- same narrower-than-`InvalidTransition` shape as
    `NoShowBeforeStartTime` above, just the mirror-image deadline: the
    transition itself is legal, it just isn't legal *any more*, because
    `booking.start_time` is inside
    `bookings.transitions.CANCELLATION_MIN_NOTICE` of "now." A distinct
    exception rather than folding this into `InvalidTransition` -- the
    view needs to tell the frontend "you're too close to your appointment
    to cancel" apart from "this booking isn't cancellable at all."
    Applies uniformly regardless of who's cancelling (patient, provider,
    or an admin bypass).
    """

    def __init__(
        self,
        message="This booking cannot be cancelled within 24 hours of its start time.",
    ):
        super().__init__(message)
