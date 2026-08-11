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
    than the id yet. Reused as-is for `PATCH /bookings/<id>/status`'s
    response (TICKET-08) -- same canonical shape, just a different status
    value.
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


class BookingStatusUpdateSerializer(serializers.Serializer):
    """Validates `PATCH /bookings/<id>/status`'s body (TICKET-08).
    Deliberately excludes `requested`/`confirmed` from the allowed
    choices -- there is no confirm/decline action (architecture.md §4's
    auto-accept rule; every booking a provider sees already arrived
    `confirmed`), so a provider can only ever move a booking to one of
    these three values. Whether that specific transition is legal from
    the booking's *current* status is `bookings.transitions.transition`'s
    job, not this serializer's -- this only rejects garbage input.
    """

    status = serializers.ChoiceField(
        choices=[Booking.Status.COMPLETED, Booking.Status.CANCELLED, Booking.Status.NO_SHOW]
    )


class BookingListQuerySerializer(serializers.Serializer):
    """Validates `GET /bookings`'s query string (TICKET-08). Every field is
    optional: `provider_id` is ignored for a requesting provider (see
    `BookingListCreateView.get` -- always scoped to `request.user` for that
    role) and `date_from`/`date_to` default to no range filter at all,
    i.e. every one of the caller's own bookings.
    """

    provider_id = serializers.IntegerField(min_value=1, required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if bool(date_from) != bool(date_to):
            raise serializers.ValidationError(
                "date_from and date_to must be provided together."
            )
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError("date_to must not be before date_from.")
        return attrs


class BookingListSerializer(serializers.ModelSerializer):
    """Output shape for `GET /bookings` (TICKET-08's provider calendar
    list): `{id, patient_id, patient_name, appointment_type_name,
    start_time, end_time, status}` -- a small joined/denormalized read
    shape (per this ticket's brief), distinct from `BookingSerializer`'s
    canonical `_id`-only shape, since a calendar UI needs display names
    without a second round-trip per row.
    """

    patient_id = serializers.IntegerField(read_only=True)
    patient_name = serializers.CharField(source="patient.name", read_only=True)
    appointment_type_name = serializers.CharField(source="appointment_type.name", read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "patient_id",
            "patient_name",
            "appointment_type_name",
            "start_time",
            "end_time",
            "status",
        ]
        read_only_fields = fields
