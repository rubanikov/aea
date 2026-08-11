"""Domain-level failures `bookings.services.create_booking` and
`bookings.transitions.transition` raise instead of letting a raw DB
exception (or a silent wrong success) reach the view. `bookings.views`
catches these and turns each into a specific, clean 4xx -- this ticket's
point 2 requirement ("a specific exception type, caught by the view and
turned into a clean 409, not a 500") extended to also cover the distinct
400 cases from point 6 and TICKET-08's transition guard.
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


class SlotNotOpen(BookingConflict):
    """The requested slot was never bookable to begin with -- outside the
    provider's working hours, inside a blocked range, or in the past
    (this ticket's point 6). Maps to `400 Bad Request`, distinct from
    `SlotNoLongerAvailable`'s `409`: this is invalid input, not a race the
    request lost.
    """

    def __init__(self, message="This slot is not currently available for booking."):
        super().__init__(message)


class TransitionError(Exception):
    """Base class for a `bookings.transitions.transition()` call that
    cannot proceed (TICKET-08, architecture.md §4). Maps to `400 Bad
    Request` at the view layer -- never a 500, and never a silent no-op.
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
    itself is legal, it just isn't legal *yet*, because `booking.start_time`
    hasn't passed (this ticket's brief: "no_show only settable on a
    confirmed booking whose start time has passed").
    """

    def __init__(
        self, message="Cannot mark a booking as no-show before its start time has passed."
    ):
        super().__init__(message)


class CancellationNoticeTooShort(TransitionError):
    """`requested`/`confirmed` -> `cancelled` *is* in `ALLOWED_TRANSITIONS`
    -- same narrower-than-`InvalidTransition` shape as `NoShowBeforeStartTime`
    above, just the mirror-image deadline: the transition itself is legal,
    it just isn't legal *any more*, because `booking.start_time` is inside
    `bookings.transitions.CANCELLATION_MIN_NOTICE` of "now" (TICKET-09's
    brief: "no cancel < 24h before start"). A distinct exception rather
    than folding this into `InvalidTransition` -- the view needs to tell
    the frontend "you're too close to your appointment to cancel" apart
    from "this booking isn't cancellable at all," so it can show that
    specific reason instead of a generic failure. Applies uniformly
    regardless of who's cancelling (patient, provider, or an admin bypass)
    -- architecture.md doesn't carve out an exception for either role.
    """

    def __init__(
        self,
        message="This booking cannot be cancelled within 24 hours of its start time.",
    ):
        super().__init__(message)
