from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Q

# TICKET-04 scope. Provider timezone deliberately lives on `accounts.User`
# (see `User.timezone`, already added and validated in TICKET-02) rather than
# a new `ProviderSettings` model here — the field already exists, is already
# an IANA-validated `CharField` (accounts/serializers.py's
# `UserSerializer.validate_timezone`), and reusing it avoids a redundant
# OneToOne row for something that's a property of every account, not just
# providers. See `scheduling/slots.py` for where it's read at
# slot-generation time.


class Availability(models.Model):
    """A provider's recurring weekly working hours: one row per contiguous
    block of time on one day of the week (architecture.md §2 — "Availability
    ... provider's recurring working hours (day-of-week + start/end time)").

    `start_time`/`end_time` are plain, timezone-naive `TimeField`s on
    purpose: they're wall-clock times in the provider's own timezone
    (`provider.timezone`), not instants. Resolving them to actual UTC
    instants only happens at slot-generation time, once a specific calendar
    date is in play (`scheduling/slots.py`) — storing them pre-resolved
    would bake in whatever UTC offset was current on the day they were
    entered, which breaks the moment a DST transition happens.
    """

    class DayOfWeek(models.IntegerChoices):
        """Matches `datetime.date.weekday()` (Monday=0 ... Sunday=6) so
        slot generation can index straight off `date.weekday()` with no
        translation table."""

        MONDAY = 0, "Monday"
        TUESDAY = 1, "Tuesday"
        WEDNESDAY = 2, "Wednesday"
        THURSDAY = 3, "Thursday"
        FRIDAY = 4, "Friday"
        SATURDAY = 5, "Saturday"
        SUNDAY = 6, "Sunday"

    provider = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="availability_windows",
    )
    day_of_week = models.IntegerField(choices=DayOfWeek.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["day_of_week", "start_time"]
        constraints = [
            models.CheckConstraint(
                condition=Q(start_time__lt=F("end_time")),
                name="availability_start_before_end",
            ),
        ]

    def __str__(self):
        return (
            f"{self.get_day_of_week_display()} {self.start_time}-{self.end_time} "
            f"({self.provider_id})"
        )

    def clean(self):
        # Role is enforced here at the application layer, not a DB
        # constraint (this ticket's brief: "should probably validate
        # role='provider' ... not a DB constraint" — a user's role can
        # change over time and a DB CHECK can't reach across tables to
        # verify it).
        if self.provider_id and self.provider.role != self.provider.Role.PROVIDER:
            raise ValidationError({"provider": "Availability can only be set for a provider."})
        if self.start_time is not None and self.end_time is not None:
            if self.start_time >= self.end_time:
                raise ValidationError({"end_time": "end_time must be after start_time."})


class AppointmentType(models.Model):
    """A provider-defined visit type and its duration (architecture.md §2 —
    duration is per-`AppointmentType`, never a fixed global increment).

    No forced snapping to a 10/15-minute grid: `duration_minutes` accepts
    any positive integer. The slot-generation loop
    (`scheduling/slots.py::get_open_slots`) starts each day's slicing at the
    availability window's own start time and steps forward by exactly
    `duration_minutes` each time, so slots are always contiguous and
    correctly sized regardless of whether the duration happens to be a
    round number — there's no shared grid for durations to collide on, so
    there's nothing a forced snap would protect against.
    """

    provider = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="appointment_types",
    )
    name = models.CharField(max_length=100)
    duration_minutes = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "name"], name="unique_appointment_type_name_per_provider"
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.duration_minutes}min, provider={self.provider_id})"

    def clean(self):
        if self.provider_id and self.provider.role != self.provider.Role.PROVIDER:
            raise ValidationError(
                {"provider": "Appointment types can only be defined by a provider."}
            )
