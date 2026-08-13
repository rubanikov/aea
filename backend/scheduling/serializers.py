from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import AppointmentType, Availability, BlockedTime
from .slots import MAX_SLOT_QUERY_RANGE_DAYS

User = get_user_model()


class AvailabilitySerializer(serializers.ModelSerializer):
    """`provider` is deliberately not a field here -- the view always sets
    it from `request.user` (see `AvailabilityListView.get`), so a
    client can never create a working-hours row for anyone but themselves.

    `effective_from` is read-only: which generation a row belongs to is
    decided by the schedule-save flow (`PUT /scheduling/schedule`), never
    by a client writing the field directly.
    """

    class Meta:
        model = Availability
        fields = ["id", "day_of_week", "start_time", "end_time", "effective_from"]
        read_only_fields = ["id", "effective_from"]

    def validate(self, attrs):
        start = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end = attrs.get("end_time", getattr(self.instance, "end_time", None))
        if start is not None and end is not None and start >= end:
            raise serializers.ValidationError({"end_time": "end_time must be after start_time."})
        return attrs


class AppointmentTypeSerializer(serializers.ModelSerializer):
    """Same `provider`-is-not-a-field reasoning as `AvailabilitySerializer`
    above. Uniqueness of (provider, name) is enforced by the model's
    `UniqueConstraint` and caught as an `IntegrityError` at the view layer
    (matching `accounts/views.py`'s `DUPLICATE_EMAIL_RESPONSE` pattern) --
    it isn't declared as a DRF `UniqueTogetherValidator` here because that
    validator needs both fields present on the serializer, and `provider`
    isn't.

    `duration_minutes` is read-only: every appointment is a fixed
    60-minute slot (see the model's `CheckConstraint`), so a client only
    ever sends `name` -- the server always produces 60. It stays in the
    output for display ("60 minutes"); a client-supplied value on input is
    silently ignored by DRF's read-only handling.
    """

    class Meta:
        model = AppointmentType
        fields = ["id", "name", "duration_minutes"]
        read_only_fields = ["id", "duration_minutes"]


class BlockedTimeSerializer(serializers.ModelSerializer):
    """`provider` is deliberately not a field -- same reasoning as
    `AvailabilitySerializer` above: the view always sets it from
    `request.user`."""

    class Meta:
        model = BlockedTime
        fields = ["id", "start", "end", "label"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        start = attrs.get("start", getattr(self.instance, "start", None))
        end = attrs.get("end", getattr(self.instance, "end", None))
        if start is not None and end is not None and start >= end:
            raise serializers.ValidationError({"end": "end must be after start."})
        return attrs


class ProviderSerializer(serializers.ModelSerializer):
    """Output shape for `GET /scheduling/providers` -- a patient-facing
    provider picker. Deliberately narrower than
    `accounts.serializers.UserSerializer`: `email`/`phone` aren't public in
    the way "which providers exist to book with" needs to be, so this
    exposes only `id`, display `name`, and `timezone` (shown alongside the
    patient's own timezone in the provider-picker step).
    """

    class Meta:
        model = User
        fields = ["id", "name", "timezone"]
        read_only_fields = fields


class SlotSerializer(serializers.Serializer):
    """Output shape for one `scheduling.slots.Slot`."""

    start = serializers.DateTimeField()
    end = serializers.DateTimeField()


RESOLUTION_CHOICES = ["keep_new_hours", "cancel_change"]


class ScheduleWindowSerializer(serializers.Serializer):
    """One weekly working-hours block, both directions of the schedule
    API: on input (`ScheduleWriteSerializer.windows`) a proposed window has
    no `id` yet, so it's read-only; on output (`ProviderScheduleSerializer`)
    it serializes a saved `Availability` row, `id` included.

    Deliberately no `end > start` check here: schedule-rule violations must
    come back keyed by *day index* (`{"windows": {"3": [...]}}`), not by
    list position the way a nested DRF error would -- see
    `scheduling.schedule.validate_weekly_windows`, which owns all three
    per-day rules.
    """

    id = serializers.IntegerField(read_only=True)
    day_of_week = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()


class ScheduleGenerationSerializer(serializers.Serializer):
    """One schedule generation: the calendar date it starts applying
    (`null` = the baseline, in effect since forever) plus its windows."""

    effective_from = serializers.DateField(allow_null=True)
    windows = ScheduleWindowSerializer(many=True)


class ProviderScheduleSerializer(serializers.Serializer):
    """Output of `GET /scheduling/schedule` (and of a successful `PUT`) --
    serializes the dict `scheduling.schedule.get_provider_schedule` builds.
    `today` is the provider-local date, supplied so the client never
    derives it from the browser clock; `pending` is `null` when no
    generation starts after today."""

    timezone = serializers.CharField()
    today = serializers.DateField()
    current = ScheduleGenerationSerializer()
    pending = ScheduleGenerationSerializer(allow_null=True)


class ScheduleWriteSerializer(serializers.Serializer):
    """Body of `PUT /scheduling/schedule`. `windows` is the complete weekly
    picture (a day absent means "no hours that day"; `[]` means no hours at
    all). `effective_from` is a required key: `null` replaces the live
    generation now, a future provider-local date creates/replaces the
    pending one -- "future" is validated in the view against
    `provider_today`, since it needs the requesting provider's timezone."""

    windows = ScheduleWindowSerializer(many=True)
    effective_from = serializers.DateField(required=True, allow_null=True)


class BlockedTimeResolutionSerializer(serializers.Serializer):
    """Validates the optional `resolution` field on
    `POST /scheduling/blocked-time` -- kept separate from
    `BlockedTimeSerializer` since `resolution` is not a `BlockedTime` model
    field and must never appear in `serializer.data` for the created row.
    """

    resolution = serializers.ChoiceField(
        choices=RESOLUTION_CHOICES, required=False, allow_null=True
    )


class BookingCollisionSerializer(serializers.Serializer):
    """Output shape for one affected booking in a collision response --
    enough for the frontend's affected-appointments list (and its existing
    status-badge convention) without exposing anything beyond it."""

    id = serializers.IntegerField()
    start_time = serializers.DateTimeField()
    end_time = serializers.DateTimeField()
    patient_name = serializers.CharField()
    appointment_type_name = serializers.CharField()
    status = serializers.CharField()


class ScheduleConflictSerializer(serializers.Serializer):
    """`PUT /scheduling/schedule`'s 409 body: the bookings the proposed
    timeline would strand (`BookingCollisionSerializer` shape verbatim --
    no new frontend vocabulary) plus `earliest_safe_date`, the deferral
    date picker's `min`/default. `earliest_safe_date` is `null` when
    deferring cannot clear every collision -- see
    `scheduling.schedule.earliest_safe_date`."""

    collisions = BookingCollisionSerializer(many=True)
    earliest_safe_date = serializers.DateField(allow_null=True)


class SlotQuerySerializer(serializers.Serializer):
    """Validates `GET /scheduling/slots`'s query string."""

    provider_id = serializers.IntegerField(min_value=1)
    appointment_type_id = serializers.IntegerField(min_value=1)
    date_from = serializers.DateField()
    date_to = serializers.DateField()

    def validate(self, attrs):
        if attrs["date_to"] < attrs["date_from"]:
            raise serializers.ValidationError("date_to must not be before date_from.")
        span_days = (attrs["date_to"] - attrs["date_from"]).days
        if span_days > MAX_SLOT_QUERY_RANGE_DAYS:
            raise serializers.ValidationError(
                f"date range cannot exceed {MAX_SLOT_QUERY_RANGE_DAYS} days."
            )
        return attrs
