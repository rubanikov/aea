from rest_framework import serializers

from .models import Booking


class BookingCreateSerializer(serializers.Serializer):
    """Validates `POST /bookings`'s body shape. `provider_id`/
    `appointment_type_id` existence (and that the type belongs to the
    provider) is checked in the view, same division of labor as
    `scheduling.views.SlotsView`. `end_time` is deliberately not a field at
    all -- the server always derives it from
    `appointment_type.duration_minutes` (this ticket's point 1), so there
    is no way for a client to submit one.
    """

    provider_id = serializers.IntegerField(min_value=1)
    appointment_type_id = serializers.IntegerField(min_value=1)
    start_time = serializers.DateTimeField()


class BookingSerializer(serializers.ModelSerializer):
    """Output shape for a created/returned `Booking`: `{id, provider_id,
    patient_id, appointment_type_id, start_time, end_time, status}` (this
    ticket's point 8). Exposes the related rows as their raw `_id` FK
    columns rather than nested objects -- nothing downstream needs more
    than the id yet.
    """

    provider_id = serializers.IntegerField(read_only=True)
    patient_id = serializers.IntegerField(read_only=True)
    appointment_type_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "provider_id",
            "patient_id",
            "appointment_type_id",
            "start_time",
            "end_time",
            "status",
        ]
        read_only_fields = fields
