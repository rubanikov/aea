"""`Booking` -- the actual appointment (architecture.md §2, §3's
double-booking guard, §4's status enum + auto-accept rule). Lives in its
own app rather than `scheduling`: `scheduling` models availability
*rules* (working hours, appointment types, blocked ranges); `Booking` is
the reservation made against those rules, central enough (reschedule/
cancel/status lifecycle, reminders) to own its own app boundary.

`bookings` depends on `scheduling` (this file imports `AppointmentType`),
never the other way at the model layer -- `scheduling/views.py` importing
`bookings.models.Booking` is a views-to-models edge, not a
models-to-models cycle.
"""

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from django.db import models
from django.db.models import F, Func, Q

from scheduling.models import AppointmentType


class TsTzRange(Func):
    """`TSTZRANGE(start, end)` -- builds a Postgres timestamptz range for
    the exclusion constraints below. TSTZRANGE's default bounds are `[)`
    (start-inclusive, end-exclusive), exactly the half-open interval
    convention every overlap check in this codebase already uses
    (`start_time__lt` / `end_time__gt`), so back-to-back bookings never
    read as overlapping.
    """

    function = "TSTZRANGE"
    output_field = DateTimeRangeField()


class Booking(models.Model):
    class Status(models.TextChoices):
        """Matches architecture.md §4's exact enum. `bookings.transitions
        .transition()` is the one write path for every status change on
        this field -- see `ALLOWED_TRANSITIONS` there for which
        transitions are legal. Never assign `.status` directly outside a
        migration or a fixture/test helper that's deliberately setting up
        a starting state.
        """

        REQUESTED = "requested", "Requested"
        CONFIRMED = "confirmed", "Confirmed"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "No-show"

    # The statuses that still occupy a slot -- what both the concurrency
    # guard (`bookings.services._book_open_slot`) and the DB constraints
    # below treat as "blocking." Cancelled/completed/no-show bookings
    # never block a slot.
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
    # Server-side double-submit dedup: the client generates one key per
    # booking attempt and resends the same value on retry -- see
    # `bookings.views.IDEMPOTENCY_KEY_HEADER` for the transport. Nullable
    # + globally unique: a client that never sends one just falls back to
    # Layer 1/Layer 2 alone for correctness -- Postgres treats multiple
    # NULLs in a unique column as distinct, so that's never a false
    # collision between two keyless bookings.
    idempotency_key = models.CharField(max_length=255, null=True, blank=True, unique=True)
    # The provider's written reason for a cancellation. Only ever written
    # by `bookings.transitions.transition()` alongside a `-> CANCELLED`
    # status change through the provider status endpoint; every other
    # cancel path (patient self-cancel, reschedule's implicit cancel,
    # account deletion's bulk cancel) leaves it `""`. Never nullable --
    # "" is the one "no reason recorded" value, so readers never branch
    # on None. Length is capped at 500 chars by
    # `BookingStatusUpdateSerializer`, not here: that's a
    # request-validation rule, not a storage invariant.
    cancellation_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # `audit.ownership` convention (see
    # `scheduling.models.Availability.owner_field_name`). `patient`, not
    # `provider`: this is the patient's appointment to view/reschedule/
    # cancel -- a provider's view of their own calendar is a separate,
    # provider-scoped query, not an ownership check against this model.
    owner_field_name = "patient"

    class Meta:
        ordering = ["-start_time"]
        constraints = [
            # Layer 2 (architecture.md §3) -- the unconditional DB backstop
            # for the identical-start case: even a bug in Layer 1 can't
            # commit two active bookings for the same provider + exact
            # start time, because Postgres's own partial unique index
            # physically refuses the second insert. With mixed 30/60
            # durations a true overlap no longer implies an identical
            # start_time, so the exclusion constraints below carry the
            # general overlap case; these stay as cheap, self-documenting
            # guards for the exact-start special case.
            models.UniqueConstraint(
                fields=["provider", "start_time"],
                condition=Q(status__in=["requested", "confirmed"]),
                name="unique_active_booking_per_provider_slot",
            ),
            # Mirror of the provider constraint on the patient axis: a
            # patient cannot sit in two chairs at the same start time,
            # even across different providers.
            models.UniqueConstraint(
                fields=["patient", "start_time"],
                condition=Q(status__in=["requested", "confirmed"]),
                name="unique_active_booking_per_patient_slot",
            ),
            # Layer 2's general form, required once 30- and 60-minute
            # types coexist: a 60-minute booking at 09:00 and a 30-minute
            # one at 09:30 overlap *without* sharing a start_time, so two
            # such inserts racing (nothing committed yet for Layer 1's
            # `select_for_update` to lock, and no identical start for the
            # unique indexes to refuse) would both land. A btree_gist
            # exclusion constraint on (provider, [start, end)) makes
            # Postgres itself refuse the second overlapping active insert,
            # whatever the two spans' shapes.
            ExclusionConstraint(
                name="no_overlapping_active_booking_per_provider",
                expressions=[
                    (TsTzRange("start_time", "end_time"), RangeOperators.OVERLAPS),
                    ("provider", RangeOperators.EQUAL),
                ],
                condition=Q(status__in=["requested", "confirmed"]),
            ),
            # Same guard on the patient axis: a patient must never hold
            # two overlapping active bookings, even with two different
            # providers -- the generalization of
            # `unique_active_booking_per_patient_slot`'s one-per-start
            # rule to mixed durations.
            ExclusionConstraint(
                name="no_overlapping_active_booking_per_patient",
                expressions=[
                    (TsTzRange("start_time", "end_time"), RangeOperators.OVERLAPS),
                    ("patient", RangeOperators.EQUAL),
                ],
                condition=Q(status__in=["requested", "confirmed"]),
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


class CancellationNotificationLog(models.Model):
    """One row per cancellation notification sent *at* a patient -- the
    counter behind `bookings.notifications`' per-recipient hourly budget.

    Same lightweight shape as `reminders.models.ReminderLog`, but differs
    in two ways: it hangs off the *patient*, not the booking (the abuse
    this caps is a cancel/rebook loop pumping attacker-written text at
    one recipient, and only the recipient stays constant across that
    loop's fresh booking ids); and a row means "an attempt was made," not
    "a send succeeded" -- a send that died at the transport still spent a
    unit of the budget.

    Nothing reads these rows except the budget check, and nothing prunes
    them yet -- one row per cancellation is a rounding error next to
    `AuditLog`.
    """

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cancellation_notification_logs",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # The only query there is: "how many for this patient since
            # <time>" (`notifications._claim_recipient_budget`).
            models.Index(
                fields=["patient", "created_at"], name="cancel_notif_patient_time_idx"
            )
        ]

    def __str__(self):
        return f"cancellation notification patient={self.patient_id} at={self.created_at}"
