from django.db.models import Exists, OuterRef, QuerySet
from rest_framework import serializers

from reminders.models import ReminderLog

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


class BookingRescheduleSerializer(serializers.Serializer):
    """Validates `PATCH /bookings/<id>/reschedule`'s body (TICKET-10):
    `{start_time}` only. `provider_id`/`appointment_type_id` are
    deliberately not fields here at all -- a reschedule moves an existing
    booking to another open slot for the *same* provider and appointment
    type (this ticket's own framing: "move this appointment to another
    open slot," not "rebook from scratch"), so there is nothing for either
    to bind to and both are silently ignored if sent, the same as
    `end_time` on `BookingCreateSerializer`.
    """

    start_time = serializers.DateTimeField()


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


class PatientBookingReminderAnnotatedListSerializer(serializers.ListSerializer):
    """`PatientBookingListSerializer`'s `list_serializer_class` -- adds the
    `reminder_sent` field (TICKET-12's addendum to TICKET-09's UI, per
    `tickets/README.md`'s scope-adjustment #7) without turning `GET
    /bookings/mine` into an N+1: a `SerializerMethodField` querying
    `ReminderLog` per row would issue one query per booking in the
    response. Instead this re-annotates the queryset
    `BookingMineListView.get` already built with a single correlated
    `EXISTS` subquery -- `reminder_sent` comes back as part of the same
    list query, not a second round trip per row (or at all).

    Deliberately does this here rather than in the view: the view's
    queryset stays exactly as it was (nothing there needs to know this
    field exists), and the annotation lives next to the field it feeds,
    the same locality `BookingListSerializer.appointment_type_name`'s
    `source="appointment_type.name"` already keeps between a display field
    and how it's populated.
    """

    def to_representation(self, data):
        if isinstance(data, QuerySet):
            data = data.annotate(
                reminder_sent=Exists(
                    ReminderLog.objects.filter(
                        booking=OuterRef("pk"), interval=ReminderLog.INTERVAL_24H
                    )
                )
            )
        return super().to_representation(data)


class PatientBookingListSerializer(serializers.ModelSerializer):
    """Output shape for `GET /bookings/mine` (TICKET-09's patient "My
    Appointments" list): `{id, provider_id, provider_name,
    appointment_type_id, appointment_type_name, start_time, end_time,
    status, reminder_sent}` -- the patient-facing mirror of
    `BookingListSerializer` above, joined on `provider` instead of
    `patient` since the patient viewing their own list already knows who
    they are. Matches `frontend/lib/bookings/types.ts`'s `PatientBooking`
    field-for-field -- that type was written against this assumed contract
    before this endpoint existed, so the shape here is load-bearing, not
    incidental.

    `appointment_type_id` (added post-TICKET-10, alongside the display-only
    `_name` field TICKET-09 already had): the reschedule flow needs the id
    to call `GET /scheduling/slots`/`GET /scheduling/providers/:id/
    appointment-types`, not just the name -- without it, a consumer has to
    resolve name-to-id via a second network round trip (matched against
    `unique_appointment_type_name_per_provider`, since names are only
    unique per provider, not globally). Exposing the id directly removes
    that indirection and the "type renamed/deleted between calls" edge case
    it implies.

    `reminder_sent` (added TICKET-12): whether a `ReminderLog` row exists
    for this booking's 24h interval, i.e. whether the reminder email has
    already gone out -- see `PatientBookingReminderAnnotatedListSerializer`
    above for how it's populated without an N+1. `BookingListSerializer`
    (the provider-facing list) doesn't carry this field yet -- deferred to
    a fast follow-up rather than bundled into this change.
    """

    provider_id = serializers.IntegerField(read_only=True)
    provider_name = serializers.CharField(source="provider.name", read_only=True)
    appointment_type_id = serializers.IntegerField(read_only=True)
    appointment_type_name = serializers.CharField(source="appointment_type.name", read_only=True)
    reminder_sent = serializers.BooleanField(read_only=True)

    class Meta:
        model = Booking
        list_serializer_class = PatientBookingReminderAnnotatedListSerializer
        fields = [
            "id",
            "provider_id",
            "provider_name",
            "appointment_type_id",
            "appointment_type_name",
            "start_time",
            "end_time",
            "status",
            "reminder_sent",
        ]
        read_only_fields = fields
