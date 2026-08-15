from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

# Provider timezone lives on `accounts.User` (`User.timezone`, an
# IANA-validated `CharField`) rather than a new `ProviderSettings` model —
# the field already exists and reusing it avoids a redundant OneToOne row for
# something that's a property of every account, not just providers. See
# `scheduling/slots.py` for where it's read at slot-generation time.


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
    # Calendar date (in `provider.timezone`, same wall-clock reasoning as
    # `start_time`/`end_time` above) on which this row's generation takes
    # effect. NULL marks the baseline generation — in effect since forever,
    # before any dated change was saved.
    effective_from = models.DateField(null=True, blank=True)

    # Lets `audit.permissions.IsOwnerOrAdmin` resolve row ownership without a
    # model-specific branch (see `scheduling/views.py`).
    owner_field_name = "provider"

    class Meta:
        # `nulls_first` keeps the baseline (NULL) generation ahead of every
        # dated one regardless of the database's default NULL placement
        # (Postgres sorts NULLs last on ASC).
        ordering = [F("effective_from").asc(nulls_first=True), "day_of_week", "start_time"]
        indexes = [
            models.Index(
                fields=["provider", "effective_from", "day_of_week"],
                name="availability_provider_gen_idx",
            ),
        ]
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
        # Role is enforced at the application layer, not a DB constraint:
        # a user's role can change over time and a DB CHECK can't reach
        # across tables to verify it.
        if self.provider_id and self.provider.role != self.provider.Role.PROVIDER:
            raise ValidationError({"provider": "Availability can only be set for a provider."})
        if self.start_time is not None and self.end_time is not None:
            if self.start_time >= self.end_time:
                raise ValidationError({"end_time": "end_time must be after start_time."})


class AppointmentType(models.Model):
    """A provider-defined visit type — a named category that drives
    tag-coloring on the calendar (e.g. "Consultation" vs "Follow-up").
    Every appointment is either a 30- or a 60-minute slot (exactly those
    two choices — a product decision): `duration_minutes` defaults to 60
    and a `CheckConstraint` guarantees no other value can ever be stored.
    The field stays on the model rather than hardcoding the choices in
    `scheduling/slots.py` so the model is the single source of truth the
    slot-generation loop reads. A small closed value set is exactly what a
    DB `CheckConstraint` is for.
    """

    DURATION_CHOICES_MINUTES = (30, 60)
    DEFAULT_DURATION_MINUTES = 60

    provider = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="appointment_types",
    )
    name = models.CharField(max_length=100)
    duration_minutes = models.PositiveIntegerField(default=DEFAULT_DURATION_MINUTES)

    owner_field_name = "provider"

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "name"], name="unique_appointment_type_name_per_provider"
            ),
            models.CheckConstraint(
                condition=Q(duration_minutes__in=[30, 60]),
                name="appointment_type_duration_in_30_60",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.duration_minutes}min, provider={self.provider_id})"

    def clean(self):
        if self.provider_id and self.provider.role != self.provider.Role.PROVIDER:
            raise ValidationError(
                {"provider": "Appointment types can only be defined by a provider."}
            )


class BlockedTime(models.Model):
    """A provider-declared date/time range during which no slot should ever
    be computed as bookable, regardless of what `Availability` says.

    `start`/`end` are tz-aware UTC `DateTimeField`s — unlike `Availability`,
    a block is a one-off instant range (e.g. "on vacation Aug 20-27"), not a
    recurring wall-clock weekly pattern, so there's no DST-resolution step to
    defer. `get_open_slots` treats this as just another busy interval; see
    `SlotsView.get` in `views.py` for where blocked ranges are folded into
    `busy_intervals`.
    """

    provider = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="blocked_times",
    )
    start = models.DateTimeField()
    end = models.DateTimeField()
    label = models.CharField(max_length=100, blank=True)

    owner_field_name = "provider"
    # `audit_target_type` keeps `AuditLog.target_type` as the readable
    # `"blocked_time"` rather than the default lowercased class name
    # `"blockedtime"` — see `audit.ownership.target_type_for`.
    audit_target_type = "blocked_time"

    class Meta:
        ordering = ["start"]
        constraints = [
            models.CheckConstraint(
                condition=Q(start__lt=F("end")),
                name="blocked_time_start_before_end",
            ),
        ]

    def __str__(self):
        return f"{self.start}-{self.end} ({self.provider_id})"

    def clean(self):
        if self.provider_id and self.provider.role != self.provider.Role.PROVIDER:
            raise ValidationError({"provider": "Blocked time can only be set for a provider."})
        if self.start is not None and self.end is not None:
            if self.start >= self.end:
                raise ValidationError({"end": "end must be after start."})
