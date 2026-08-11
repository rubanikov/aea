import logging
from datetime import datetime, time
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from scheduling.models import AppointmentType

from .exceptions import (
    InvalidTransition,
    NoShowBeforeStartTime,
    SlotNoLongerAvailable,
    SlotNotOpen,
)
from .models import Booking
from .permissions import IsBookingProviderOrAdmin
from .serializers import (
    BookingCreateSerializer,
    BookingListQuerySerializer,
    BookingListSerializer,
    BookingSerializer,
    BookingStatusUpdateSerializer,
)
from .services import create_booking
from .transitions import transition

User = get_user_model()
logger = logging.getLogger(__name__)

# Transport for this ticket's double-submit dedup key (point 4): a plain
# request header, not a body field -- a naive retry that resubmits the
# identical JSON body still carries the same key automatically, with no
# extra work by the client beyond generating it once. The frontend
# generates one key (e.g. `crypto.randomUUID()`) when the booking-confirm
# panel opens and resends that same value on every retry of that attempt.
IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"

# Matches `Booking.idempotency_key`'s `max_length` -- rejected up front with
# a clean 400 rather than surfacing a raw `DataError` out of Postgres's own
# `varchar(255)` limit (project.md's "oversized requests are rejected with
# clear errors, never an unhandled 500").
MAX_IDEMPOTENCY_KEY_LENGTH = 255


class BookingListCreateView(APIView):
    """`GET`/`POST /bookings`.

    `POST` -- create, and (architecture.md §4) immediately auto-confirm, a
    booking. Patient-only: `patient` is always `request.user`, never
    client-supplied -- same pattern as `provider` being forced server-side
    on `scheduling.views.BlockedTimeListCreateView`.

    Body: `{provider_id, appointment_type_id, start_time}` -- `start_time`
    exactly as returned by `GET /scheduling/slots`. `end_time` is always
    computed server-side from the appointment type's duration.

    Responses: `201` with the created (already-`confirmed`) booking;
    `400` for unknown provider/type, a malformed body, or a `start_time`
    that isn't currently an open slot; `409` if the slot was open but lost
    a race for it (either guard layer); `401` unauthenticated; `403` for a
    non-patient role.

    `GET /bookings?provider_id=&date_from=&date_to=` (TICKET-08) -- the
    provider calendar's list/agenda feed. Provider-and-admin only (see
    `get` below for why a patient's own appointment list is deliberately
    *not* built here -- TICKET-09 owns that, as its own endpoint, with its
    own display shape). A requesting provider always sees only their own
    bookings, regardless of any `provider_id` given -- same "ignore it,
    scope to `request.user`" shape as `scheduling.views
    .AvailabilityListCreateView.get`. An admin sees every booking, or one
    provider's if `provider_id` is given. `date_from`/`date_to` are an
    optional pair of UTC calendar-date bounds on `start_time` -- this is a
    read/list view, not `scheduling.slots.get_open_slots`'s provider-local-
    timezone-aware slot computation, so the simpler UTC-day interpretation
    is deliberate here (see this ticket's handoff notes).
    """

    def get(self, request):
        if request.user.role == User.Role.PATIENT:
            return Response(
                {"detail": "Patients cannot list bookings from this endpoint."},
                status=status.HTTP_403_FORBIDDEN,
            )

        query = BookingListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data

        queryset = Booking.objects.select_related("patient", "appointment_type")
        if request.user.role == User.Role.PROVIDER:
            queryset = queryset.filter(provider=request.user)
        elif params.get("provider_id"):
            queryset = queryset.filter(provider_id=params["provider_id"])

        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from and date_to:
            queryset = queryset.filter(
                start_time__gte=datetime.combine(date_from, time.min, tzinfo=dt_timezone.utc),
                start_time__lte=datetime.combine(date_to, time.max, tzinfo=dt_timezone.utc),
            )

        queryset = queryset.order_by("start_time")
        return Response(BookingListSerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role != User.Role.PATIENT:
            return Response(
                {"detail": "Only patients can book appointments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            provider = User.objects.get(pk=data["provider_id"], role=User.Role.PROVIDER)
        except User.DoesNotExist:
            return Response({"detail": "Provider not found."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            appointment_type = AppointmentType.objects.get(
                pk=data["appointment_type_id"], provider=provider
            )
        except AppointmentType.DoesNotExist:
            return Response(
                {"detail": "Appointment type not found for this provider."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        idempotency_key = request.headers.get(IDEMPOTENCY_KEY_HEADER) or None
        if idempotency_key and len(idempotency_key) > MAX_IDEMPOTENCY_KEY_LENGTH:
            return Response(
                {"detail": f"{IDEMPOTENCY_KEY_HEADER} header exceeds "
                           f"{MAX_IDEMPOTENCY_KEY_LENGTH} characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            booking = create_booking(
                patient=request.user,
                provider=provider,
                appointment_type=appointment_type,
                start_time=data["start_time"],
                idempotency_key=idempotency_key,
            )
        except SlotNotOpen as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except SlotNoLongerAvailable as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        logger.info(
            "booking created id=%s provider_id=%s patient_id=%s status=%s",
            booking.id,
            provider.id,
            request.user.id,
            booking.status,
        )
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class BookingStatusView(APIView):
    """`PATCH /bookings/<id>/status` (TICKET-08) -- a provider (or admin)
    moves a booking to `completed`/`cancelled`/`no_show`. No confirm/
    decline action here (architecture.md §4's auto-accept rule; this
    ticket's brief) -- `requested`/`confirmed` are not accepted values
    (see `BookingStatusUpdateSerializer`), and there is nothing left to
    confirm since every booking a provider sees already arrived
    `confirmed`. Patient-initiated cancellation is TICKET-09's endpoint,
    not this one: `IsBookingProviderOrAdmin` only ever admits the
    booking's own `provider`, or an admin.

    Responses: `200` with the updated booking; `400` for an invalid
    transition (including the no-show-before-start-time case) or a bad
    body; `403` if the requester isn't the booking's provider/admin;
    `404` if the booking doesn't exist.
    """

    permission_classes = [IsBookingProviderOrAdmin]

    def patch(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        self.check_object_permissions(request, booking)

        serializer = BookingStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]

        try:
            transition(booking, new_status, actor=request.user)
        except (InvalidTransition, NoShowBeforeStartTime) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(
            "booking status updated id=%s actor_id=%s new_status=%s",
            booking.id,
            request.user.id,
            new_status,
        )
        return Response(BookingSerializer(booking).data)
