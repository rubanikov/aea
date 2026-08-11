from rest_framework import serializers

from .models import AppointmentType, Availability, BlockedTime
from .slots import MAX_SLOT_QUERY_RANGE_DAYS


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


class SlotSerializer(serializers.Serializer):
    """Output shape for one `scheduling.slots.Slot`."""

    start = serializers.DateTimeField()
    end = serializers.DateTimeField()


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
