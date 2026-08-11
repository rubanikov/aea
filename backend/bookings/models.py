"""`Booking` -- the actual appointment (architecture.md §2, §3's
double-booking guard, §4's status enum + auto-accept rule). Lives in its
own app rather than `scheduling`: `scheduling` models availability *rules*
(working hours, appointment types, blocked ranges); `Booking` is the
reservation made against those rules, and is central enough (reschedule/
cancel/status lifecycle in TICKET-08/09/10, reminders later) to own its
app boundary rather than growing `scheduling` past what it was scoped for.

`bookings` depends on `scheduling` (this file imports `AppointmentType`),
never the other way at the model layer -- `scheduling/views.py` importing
`bookings.models.Booking` (TICKET-07's `SlotsView` update) is a
views-to-models edge, not a models-to-models cycle.
"""

from django.conf import settings
from django.db import models
from django.db.models import F, Q

from scheduling.models import AppointmentType


class Booking(models.Model):
    class Status(models.TextChoices):
        """Matches architecture.md §4's exact enum. This ticket only wires
        up the two transitions it needs -- create -> `REQUESTED`, then
        immediately `REQUESTED` -> `CONFIRMED`, both server-side inside the
        same request (see `bookings.services.create_booking`) -- no generic
        `transition()` function and no `COMPLETED`/`CANCELLED`/`NO_SHOW`
        transition logic. Those values exist here now purely so later
        tickets don't need a schema migration just to add them.
        """

        REQUESTED = "requested", "Requested"
        CONFIRMED = "confirmed", "Confirmed"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "No-show"

    # The statuses that still occupy a provider's slot -- what the
    # concurrency guard (`bookings.services.create_booking`'s Layer 1 query)
    # and the partial `UniqueConstraint` below both treat as "blocking."
    # `CANCELLED`/`COMPLETED`/`NO_SHOW` bookings never block a slot.
    ACTIVE_STATUSES = [Status.REQUESTED, Status.CONFIRMED]

    provider = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookings_as_provider"
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookings_as_patient"
    )
    appointment_type = models.ForeignKey(
        AppointmentType, on_delete=models.CASCADE, related_name="bookings"
    )
    # UTC instants, never naive local values (architecture.md §5).
    # `end_time` is always derived server-side from
    # `appointment_type.duration_minutes` at creation time
    # (`bookings.services.create_booking`) -- never accepted from the
    # client, so a request can't submit a mismatched/malicious duration.
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)
    # Server-side double-submit dedup (this ticket's point 4): the client
    # generates one key per booking attempt and resends the same value on
    # retry -- see `bookings.views.IDEMPOTENCY_KEY_HEADER` for the exact
    # transport. Nullable + globally unique: a client that never sends one
    # just falls back to Layer 1/Layer 2 alone for correctness -- Postgres
    # treats multiple NULLs in a unique column as distinct, so that's never
    # a false collision between two keyless bookings.
    idempotency_key = models.CharField(max_length=255, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # `audit.ownership` convention (see
    # `scheduling.models.Availability.owner_field_name`). `patient`, not
    # `provider`: this is the patient's appointment to view/reschedule/
    # cancel (TICKET-08/09 scope) -- a provider's view of their own
    # calendar is a separate, provider-scoped query, not an ownership check
    # against this model.
    owner_field_name = "patient"

    class Meta:
        ordering = ["-start_time"]
        constraints = [
            # Layer 2 (architecture.md §3) -- the unconditional DB
            # backstop. Independent of Layer 1's `select_for_update` query
            # in `bookings.services.create_booking` being correct: even a
            # bug there can't commit two active bookings for the same
            # provider + exact start time, because Postgres's own partial
            # unique index physically refuses the second insert.
            models.UniqueConstraint(
                fields=["provider", "start_time"],
                condition=Q(status__in=["requested", "confirmed"]),
                name="unique_active_booking_per_provider_slot",
            ),
            models.CheckConstraint(
                condition=Q(start_time__lt=F("end_time")), name="booking_start_before_end"
            ),
        ]

    def __str__(self):
        return (
            f"{self.start_time}-{self.end_time} provider={self.provider_id} "
            f"status={self.status}"
        )
