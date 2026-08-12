import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from audit.permissions import IsOwnerOrAdmin
from audit.services import record_audit_event
from scheduling.models import AppointmentType

from . import notifications
from .exceptions import (
    CancellationNoticeTooShort,
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
    BookingRescheduleSerializer,
    BookingSerializer,
    BookingStatusUpdateSerializer,
    PatientBookingListSerializer,
)
from .services import create_booking, reschedule_booking
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


class CancellationRateThrottle(UserRateThrottle):
    """Per-account limit on *cancellations* through
    `BookingStatusView` (see `DEFAULT_THROTTLE_RATES["booking_cancel"]`).

    Every cancel through that endpoint sends the patient provider-written
    text by email and, when a carrier is on file, by SMS. Without a limit
    of its own that send loop sat behind nothing but the generic 300/min
    account throttle, which is a lot of attacker-influenced mail to point
    at one inbox or phone.

    Narrowed to cancellations rather than the whole PATCH: DRF runs
    throttles in `initial()`, before the handler, but the parsed body is
    already available there, so the requested status is readable without
    guessing. A `completed`/`no_show` change sends nothing and is left on
    the generic throttle alone (`throttle_classes` below keeps that one
    too -- a view-level list replaces the defaults entirely).

    This is one of two limits: it caps how fast one account can cancel,
    while `notifications.RECIPIENT_HOURLY_NOTIFICATION_BUDGET` caps how
    much any single patient can be made to receive, from however many
    accounts or booking ids.
    """

    scope = "booking_cancel"

    def allow_request(self, request, view):
        requested_status = request.data.get("status") if hasattr(request.data, "get") else None
        if requested_status != Booking.Status.CANCELLED:
            return True
        return super().allow_request(request, view)


def _calendar_zone(request, provider_id):
    """The timezone `GET /bookings`'s `date_from`/`date_to` are calendar
    days *in* -- the zone of whoever's calendar is being listed.

    A provider listing their own calendar gets their own zone; an admin
    filtering to one provider gets that provider's; an admin listing every
    provider at once has no single calendar owner, so their own zone stands
    in. Never plain UTC: a provider's working day is a range on their wall
    clock, and for any provider whose day doesn't happen to sit inside a UTC
    one (an 08:00 start in Asia/Tokyo is 23:00Z the day before; a 18:00
    appointment in America/Los_Angeles is 01:00Z the day after) UTC bounds
    silently drop appointments off the ends of the week they're viewing --
    the same "one set of rows, two clocks" disagreement `SlotBrowser` had on
    the patient's side.
    """
    if request.user.role == User.Role.PROVIDER:
        return ZoneInfo(request.user.timezone)
    if provider_id:
        provider = User.objects.filter(pk=provider_id).first()
        if provider is not None:
            return ZoneInfo(provider.timezone)
    return ZoneInfo(request.user.timezone)


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
    *not* built here -- `BookingMineListView` below, `GET /bookings/mine`,
    is that endpoint, with its own display shape). A requesting provider
    always sees only their own
    bookings, regardless of any `provider_id` given -- same "ignore it,
    scope to `request.user`" shape as `scheduling.views
    .AvailabilityListCreateView.get`. An admin sees every booking, or one
    provider's if `provider_id` is given. `date_from`/`date_to` are an
    optional pair of calendar-date bounds on `start_time`, resolved in the
    timezone of whoever's calendar is being listed (`_calendar_zone` above)
    -- the same provider-local calendar day `scheduling.slots
    .get_open_slots` generates against, so a day means the same thing on
    this endpoint as it does on the patient-facing slot feed.
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
        else:
            # An admin with no `provider_id` filter sees every booking in
            # the system -- unlike `IsOwnerOrAdmin`/`IsBookingProviderOrAdmin`
            # above, there's no single object here for an object-level
            # permission check to log the bypass against (this is a list,
            # not a `check_object_permissions()` call), so it's logged
            # explicitly here instead. `target_id="*"` marks "every row,"
            # matching `admin_bypass:<action>:<target_type>`'s existing
            # convention with `<action>` set to a plain identifier
            # ("list_all") rather than a request-method fallback.
            record_audit_event(
                actor=request.user,
                action="admin_bypass:list_all:booking",
                target_type="booking",
                target_id="*",
                metadata=None,
            )

        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from and date_to:
            zone = _calendar_zone(request, params.get("provider_id"))
            queryset = queryset.filter(
                start_time__gte=datetime.combine(date_from, time.min, tzinfo=zone),
                start_time__lte=datetime.combine(date_to, time.max, tzinfo=zone),
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


class BookingMineListView(APIView):
    """`GET /bookings/mine` (TICKET-09) -- a patient's own appointment
    list, the endpoint `BookingListCreateView.get`'s docstring
    forward-references. Deliberately its own view rather than a branch
    inside that one: `BookingListCreateView.get` is provider/admin-scoped
    by design (see its docstring), and this list's display shape is
    different (`provider_name`, not `patient_name` -- see
    `PatientBookingListSerializer`).

    No `date_from`/`date_to` query params here, unlike `GET /bookings`:
    the frontend "My Appointments" page (already built against this exact
    contract -- `frontend/lib/bookings/types.ts`'s `PatientBooking`, per
    that file's own docstring) derives its Upcoming/Past/Cancelled tabs
    client-side from one unfiltered list, so this always returns every
    one of the caller's own bookings.

    Patient-only, strictly: this page is patient-only in the frontend, so
    a provider/admin caller gets `403` -- the same shape as
    `BookingListCreateView.get`'s reverse case for a patient caller,
    rather than inventing a "sensible" provider/admin response nothing
    actually needs.

    Responses: `200` with the caller's own bookings, ordered by
    `start_time`, in `PatientBookingListSerializer`'s shape (including an
    empty list when the patient has none); `403` for a non-patient
    caller; `401` unauthenticated.
    """

    def get(self, request):
        if request.user.role != User.Role.PATIENT:
            return Response(
                {"detail": "Only patients can list their own bookings from this endpoint."},
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = (
            Booking.objects.select_related("provider", "appointment_type")
            .filter(patient=request.user)
            .order_by("start_time")
        )
        return Response(PatientBookingListSerializer(queryset, many=True).data)


class BookingStatusView(APIView):
    """`PATCH /bookings/<id>/status` (TICKET-08) -- a provider (or admin)
    moves a booking to `completed`/`cancelled`/`no_show`. No confirm/
    decline action here (architecture.md §4's auto-accept rule; this
    ticket's brief) -- `requested`/`confirmed` are not accepted values
    (see `BookingStatusUpdateSerializer`), and there is nothing left to
    confirm since every booking a provider sees already arrived
    `confirmed`. Patient-initiated cancellation is TICKET-09's
    `BookingCancelView` below, not this one: `IsBookingProviderOrAdmin`
    only ever admits the booking's own `provider`, or an admin. A
    provider cancelling their *own* booking still comes through here,
    though (`cancelled` remains one of this endpoint's three allowed
    target values) -- cancel is the one transition reachable from both
    endpoints, one per ownership axis, rather than this view branching
    its permission check on the requested target status.

    Cancelling through this endpoint requires a written
    `cancellation_reason` in the body (doctor-cancel-reason-notify ticket
    01) -- see `BookingStatusUpdateSerializer` for the exact rules
    (required + non-blank for `cancelled`, rejected for `completed`/
    `no_show`). The reason is stored on the booking and echoed back in the
    response; it is deliberately *not* written to the audit log (see
    `bookings.transitions.transition`). Cancellations are additionally
    rate-limited per account (`CancellationRateThrottle` above -- `429`
    past the limit); the other two target statuses are not.

    Responses: `200` with the updated booking (including its
    `cancellation_reason`); on a `cancelled` transition the body also
    carries a `notification` key -- `bookings.notifications
    .notify_cancellation`'s result dict, sent strictly *after* the
    transition committed (see `patch` below), and never affecting the
    200 itself; `400` for an invalid transition (including
    the no-show-before-start-time and, for `cancelled`, the TICKET-09
    minimum-notice case) or a bad body; `403` if the requester isn't the
    booking's provider/admin; `404` if the booking doesn't exist.
    """

    permission_classes = [IsBookingProviderOrAdmin]
    throttle_classes = [UserRateThrottle, CancellationRateThrottle]

    def patch(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        self.check_object_permissions(request, booking)

        serializer = BookingStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        # Only ever present (and non-blank) for a `cancelled` target --
        # `BookingStatusUpdateSerializer` rejects it for any other status.
        cancellation_reason = serializer.validated_data.get("cancellation_reason")

        try:
            transition(
                booking, new_status, actor=request.user, cancellation_reason=cancellation_reason
            )
        except (InvalidTransition, NoShowBeforeStartTime, CancellationNoticeTooShort) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(
            "booking status updated id=%s actor_id=%s new_status=%s",
            booking.id,
            request.user.id,
            new_status,
        )

        body = BookingSerializer(booking).data
        if new_status == Booking.Status.CANCELLED:
            # Only after `transition()` has returned -- its atomic block has
            # committed by now, so the email can never describe a
            # cancellation that later rolls back. `notify_cancellation`
            # never raises, and its outcome never changes this response's
            # 200: the cancellation itself already succeeded, the
            # `notification` dict just tells the frontend whether the
            # patient actually got told (doctor-cancel-reason-notify
            # ticket 03).
            body["notification"] = notifications.notify_cancellation(booking)
        return Response(body)


class BookingCancelView(APIView):
    """`PATCH /bookings/<id>/cancel` (TICKET-09) -- a patient (or admin)
    cancels their own booking.

    Deliberately a separate endpoint from `PATCH /bookings/<id>/status`
    above rather than that endpoint accepting patient requests too:
    `BookingStatusView` is gated by `IsBookingProviderOrAdmin`, the
    *provider*-ownership axis (`booking.provider`); a patient cancelling
    their own appointment needs the *patient*-ownership axis instead
    (`audit.permissions.IsOwnerOrAdmin`, via `Booking.owner_field_name =
    "patient"`). Branching one view's permission check on the request's
    target status (provider-or-admin for `completed`/`no_show`,
    patient-or-admin for `cancelled`) would mix two independent
    authorization axes into a single `has_object_permission` call; two
    small single-axis views, each reusing an existing permission class
    as-is, is the same shape this codebase already uses everywhere else
    (`IsOwnerOrAdmin` on `scheduling`'s `*DetailView`s,
    `IsBookingProviderOrAdmin` above) rather than a new hybrid one. No
    request body is required or read -- the only possible target status
    here is `cancelled`.

    The minimum-notice rule (TICKET-09's brief: no cancellation within
    24h of `start_time`) lives inside `bookings.transitions.transition`
    itself, not in this view -- so it is enforced identically no matter
    which of the two endpoints, or which role, the cancellation comes
    through, and freeing the slot (this booking dropping out of `GET
    /scheduling/slots`'s `Booking.ACTIVE_STATUSES` filter) happens
    atomically with the status write inside that same function.

    Responses: `200` with the updated (now `cancelled`) booking; `400` if
    the booking isn't in a cancellable status (`InvalidTransition` -- e.g.
    already `completed`/`cancelled`/`no_show`) or the cancellation falls
    inside the 24h notice window (`CancellationNoticeTooShort`); `403` if
    the requester is neither the booking's own patient nor an admin
    (`IsOwnerOrAdmin` doesn't hide row existence from a wrong-owner
    request -- see that class's docstring); `404` if the booking doesn't
    exist; `401` unauthenticated.
    """

    permission_classes = [IsOwnerOrAdmin]

    def patch(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        self.check_object_permissions(request, booking)

        try:
            transition(booking, Booking.Status.CANCELLED, actor=request.user)
        except (InvalidTransition, CancellationNoticeTooShort) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(
            "booking cancelled id=%s actor_id=%s",
            booking.id,
            request.user.id,
        )
        return Response(BookingSerializer(booking).data)


class BookingRescheduleView(APIView):
    """`PATCH /bookings/<id>/reschedule` (TICKET-10) -- a patient (or
    admin) moves their own booking to a different open slot, same
    `provider`/`appointment_type`. Same patient-ownership axis as
    `BookingCancelView` above (`IsOwnerOrAdmin`, keyed to
    `Booking.owner_field_name = "patient"`), not the provider axis -- a
    provider does not reschedule a patient's appointment through this
    endpoint (out of scope; nothing in the brief asks for it, and
    `BookingStatusView` above remains the provider's own axis for the
    statuses it *does* manage).

    Body: `{start_time}` -- the new slot's start, exactly as returned by
    `GET /scheduling/slots` for this booking's own `provider_id`/
    `appointment_type_id`. There is no way to move provider or appointment
    type here (see `BookingRescheduleSerializer` -- neither is even a
    field); that would be a cancel followed by a fresh `POST /bookings`,
    not a reschedule, per this ticket's own framing ("move this
    appointment to another open slot").

    All the actual work -- re-validating the notice rule against the
    *original* booking, TICKET-07's double-booking guard against the *new*
    window, cancelling the old booking, and creating the already-confirmed
    new one, all atomically -- happens in
    `bookings.services.reschedule_booking`; see that function's docstring
    for the exact ordering and why. This view is a thin HTTP wrapper around
    it, the same division of labor `BookingListCreateView.post` has around
    `create_booking`.

    Response: `200` with the *new* booking, in the same shape
    `BookingSerializer` already uses everywhere else in this API
    (`{id, provider_id, patient_id, appointment_type_id, start_time,
    end_time, status}`), plus one additional field --
    `previous_booking_id`, the id of the now-`cancelled` booking this
    replaced -- so a caller can show "moved from X to Y" without a second
    request. The old booking itself is not otherwise represented in the
    body; fetch it directly (or via `GET /bookings/mine`) if its full
    updated state is needed.

    Errors: `400` if the new `start_time` isn't currently an open slot
    (`SlotNotOpen`), the reschedule falls inside the 24h notice window on
    the *original* booking (`CancellationNoticeTooShort`), or the booking
    is no longer in a reschedulable status -- already `cancelled`/
    `completed`/`no_show` (`InvalidTransition`); `409` if the new slot was
    open but lost a race for it (`SlotNoLongerAvailable`) -- same 400-vs-409
    split `POST /bookings` uses, and deliberately the same exception types,
    so a frontend that already knows how to handle a lost-the-race booking
    attempt handles a lost-the-race reschedule attempt identically; `403`
    if the requester is neither the booking's own patient nor an admin;
    `404` if the booking doesn't exist; `401` unauthenticated.
    """

    permission_classes = [IsOwnerOrAdmin]

    def patch(self, request, pk):
        booking = get_object_or_404(Booking, pk=pk)
        self.check_object_permissions(request, booking)

        serializer = BookingRescheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        start_time = serializer.validated_data["start_time"]

        try:
            new_booking = reschedule_booking(
                booking=booking, actor=request.user, start_time=start_time
            )
        except (InvalidTransition, CancellationNoticeTooShort, SlotNotOpen) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except SlotNoLongerAvailable as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        logger.info(
            "booking rescheduled old_id=%s new_id=%s actor_id=%s",
            booking.id,
            new_booking.id,
            request.user.id,
        )
        body = BookingSerializer(new_booking).data
        body["previous_booking_id"] = booking.id
        return Response(body, status=status.HTTP_200_OK)
