"""Domain-level failures `bookings.services.create_booking` raises instead
of letting a raw DB exception (or a silent wrong success) reach the view.
`bookings.views.BookingCreateView` catches these two and turns each into a
specific, clean 4xx -- this ticket's point 2 requirement ("a specific
exception type, caught by the view and turned into a clean 409, not a
500") extended to also cover the distinct 400 case from point 6.
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
