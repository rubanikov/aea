from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import AppointmentType, Availability, BlockedTime
from .slots import MAX_SLOT_QUERY_RANGE_DAYS

User = get_user_model()


class AvailabilitySerializer(serializers.ModelSerializer):
    """`provider` is deliberately not a field here -- the view always sets
    it from `request.user` (see `AvailabilityListCreateView.post`), so a
    client can never create a working-hours row for anyone but themselves.
    """

    class Meta:
        model = Availability
        fields = ["id", "day_of_week", "start_time", "end_time"]
        read_only_fields = ["id"]

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
    """

    class Meta:
        model = AppointmentType
        fields = ["id", "name", "duration_minutes"]
        read_only_fields = ["id"]


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
    provider picker (TICKET-06). Deliberately narrower than
    `accounts.serializers.UserSerializer`: `email`/`phone` aren't public in
    the way "which providers exist to book with" needs to be, so this
    exposes only what picking a provider requires -- `id`, display `name`,
    and `timezone` (surfaced for TICKET-06's dual-timezone display).
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


class ProposedAvailabilityWindowSerializer(serializers.Serializer):
    """One entry of the *complete* proposed weekly picture
    `AvailabilityCollisionCheckSerializer.windows` carries -- same three
    fields as `AvailabilitySerializer`, minus `id`: a proposed window may
    not exist as a saved row yet (or may never become one, if the provider
    cancels the change).
    """

    day_of_week = serializers.IntegerField(min_value=0, max_value=6)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()

    def validate(self, attrs):
        if attrs["start_time"] >= attrs["end_time"]:
            raise serializers.ValidationError({"end_time": "end_time must be after start_time."})
        return attrs


class AvailabilityCollisionCheckSerializer(serializers.Serializer):
    """Body of `POST /scheduling/availability/check-collisions` (TICKET-11).
    `windows` is the entire proposed weekly `Availability` state, not a
    diff -- see `scheduling.collisions.find_availability_collisions`.
    `resolution` is only present on the second call, after the frontend has
    shown the collision modal and the provider has picked one of the two
    options.
    """

    windows = ProposedAvailabilityWindowSerializer(many=True)
    resolution = serializers.ChoiceField(
        choices=RESOLUTION_CHOICES, required=False, allow_null=True
    )


class BlockedTimeResolutionSerializer(serializers.Serializer):
    """Validates the optional `resolution` field on
    `POST /scheduling/blocked-time` (TICKET-11) -- kept separate from
    `BlockedTimeSerializer` since `resolution` is not a `BlockedTime` model
    field and must never appear in `serializer.data` for the created row.
    """

    resolution = serializers.ChoiceField(
        choices=RESOLUTION_CHOICES, required=False, allow_null=True
    )


class BookingCollisionSerializer(serializers.Serializer):
    """Output shape for one affected booking in a collision response
    (TICKET-11) -- enough for the frontend's affected-appointments list
    (and its existing status-badge convention) without exposing anything
    beyond it."""

    id = serializers.IntegerField()
    start_time = serializers.DateTimeField()
    end_time = serializers.DateTimeField()
    patient_name = serializers.CharField()
    appointment_type_name = serializers.CharField()
    status = serializers.CharField()


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
