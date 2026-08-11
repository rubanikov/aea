import logging

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from scheduling.models import AppointmentType

from .exceptions import SlotNoLongerAvailable, SlotNotOpen
from .serializers import BookingCreateSerializer, BookingSerializer
from .services import create_booking

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


class BookingCreateView(APIView):
    """`POST /bookings` -- create, and (architecture.md §4) immediately
    auto-confirm, a booking. Patient-only: `patient` is always
    `request.user`, never client-supplied -- same pattern as `provider`
    being forced server-side on `scheduling.views.BlockedTimeListCreateView`.

    Body: `{provider_id, appointment_type_id, start_time}` -- `start_time`
    exactly as returned by `GET /scheduling/slots`. `end_time` is always
    computed server-side from the appointment type's duration.

    Responses: `201` with the created (already-`confirmed`) booking;
    `400` for unknown provider/type, a malformed body, or a `start_time`
    that isn't currently an open slot; `409` if the slot was open but lost
    a race for it (either guard layer); `401` unauthenticated; `403` for a
    non-patient role.
    """

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
