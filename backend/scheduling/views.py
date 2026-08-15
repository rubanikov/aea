import logging
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.permissions import IsOwnerOrAdmin
from audit.services import record_audit_event
from bookings.models import Booking

from .collisions import (
    find_blocked_time_collisions,
    find_duration_change_collisions,
    find_schedule_collisions,
)
from .models import AppointmentType, Availability, BlockedTime
from .schedule import (
    discard_pending_generation,
    effective_generation_key,
    get_provider_schedule,
    provider_today,
)
from .serializers import (
    AppointmentTypeSerializer,
    AvailabilitySerializer,
    BlockedTimeResolutionSerializer,
    BlockedTimeSerializer,
    BookingCollisionSerializer,
    ProviderScheduleSerializer,
    ProviderSerializer,
    ScheduleConflictSerializer,
    ScheduleWriteSerializer,
    SlotQuerySerializer,
    SlotSerializer,
)
from .services import (
    InvalidEffectiveFrom,
    InvalidScheduleWindows,
    ScheduleCollidesWithBookings,
    apply_schedule_change,
)
from .slots import get_open_slots

# Written when a provider edit is accepted despite leaving a booking outside
# the new hours. Two paths use it: `BlockedTime` creation with
# `resolution="keep_new_hours"`, and discarding a pending schedule change
# (`PendingScheduleView`). The live-hours `PUT /scheduling/schedule` path
# refuses to strand a booking outright (409) instead of accepting-with-audit.
BOOKING_FLAGGED_AS_EXCEPTION_ACTION = "availability_change:booking_flagged_as_exception"

User = get_user_model()
logger = logging.getLogger(__name__)

DUPLICATE_APPOINTMENT_TYPE_RESPONSE = {
    "name": ["An appointment type with this name already exists."]
}

# Detail views (`AppointmentTypeDetailView`, `BlockedTimeDetailView`) use
# `IsOwnerOrAdmin` for ownership enforcement. List/create views keep a manual
# `request.user.role == PROVIDER` check — there's no existing object for
# `has_object_permission` to check against on creation.
#
# Behavior note: a cross-provider `DELETE`/`PATCH` now returns 403, not 404.
# `IsOwnerOrAdmin` doesn't hide row existence (hiding it from admins would
# defeat the bypass it exists to provide).

PROVIDER_ONLY_SCHEDULE_RESPONSE = {"detail": "Only providers can configure working hours."}


class AvailabilityListView(APIView):
    """`GET /scheduling/availability` -- the requesting user's own
    *currently-effective* working-hours rows (the generation
    `effective_generation_key` selects for the provider-local today). Rows
    from a pending future generation never appear here, so consumers that
    mean "the hours that are live today" (e.g. the provider calendar's hour
    bounds) never double-count a deferred change.

    Writes go through `ProviderScheduleView`.
    """

    def get(self, request):
        rows = list(Availability.objects.filter(provider=request.user))
        current_key = effective_generation_key(
            {row.effective_from for row in rows}, provider_today(request.user)
        )
        live_rows = [row for row in rows if row.effective_from == current_key]
        return Response(AvailabilitySerializer(live_rows, many=True).data)


class ProviderScheduleView(APIView):
    """`GET`/`PUT /scheduling/schedule` -- a provider's whole weekly
    schedule as generations: the live one plus at most one pending change.
    Provider-only both ways; always scoped to `request.user` (`provider` is
    never read from the body).

    `GET` returns `{timezone, today, current, pending}` -- see
    `ProviderScheduleSerializer`.

    `PUT` replaces one whole generation (`effective_from: null` = the live
    one, leaving any pending change intact; a future provider-local date =
    create/replace the pending one, leaving the live hours untouched). The
    rules live in `scheduling.services.apply_schedule_change`; this view
    only maps its exceptions: `InvalidScheduleWindows` -> 400 keyed by day
    index, `InvalidEffectiveFrom` -> 400 on `effective_from`,
    `ScheduleCollidesWithBookings` -> 409 with the collision list and
    `earliest_safe_date` (nothing written). Success is a 200 with the fresh
    `GET` shape.
    """

    def get(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(PROVIDER_ONLY_SCHEDULE_RESPONSE, status=status.HTTP_403_FORBIDDEN)
        return Response(ProviderScheduleSerializer(get_provider_schedule(request.user)).data)

    def put(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(PROVIDER_ONLY_SCHEDULE_RESPONSE, status=status.HTTP_403_FORBIDDEN)

        serializer = ScheduleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            apply_schedule_change(
                request.user,
                serializer.validated_data["windows"],
                serializer.validated_data["effective_from"],
            )
        except InvalidScheduleWindows as exc:
            return Response({"windows": exc.errors}, status=status.HTTP_400_BAD_REQUEST)
        except InvalidEffectiveFrom as exc:
            return Response({"effective_from": [exc.message]}, status=status.HTTP_400_BAD_REQUEST)
        except ScheduleCollidesWithBookings as exc:
            conflict = {
                "collisions": exc.collisions,
                "earliest_safe_date": exc.earliest_safe_date,
            }
            return Response(
                ScheduleConflictSerializer(conflict).data, status=status.HTTP_409_CONFLICT
            )

        return Response(ProviderScheduleSerializer(get_provider_schedule(request.user)).data)


class PendingScheduleView(APIView):
    """`DELETE /scheduling/schedule/pending` -- discard the pending
    generation, restoring the live hours as the only schedule. Provider-only,
    same 403 as `ProviderScheduleView`.

    No collision check blocks the delete and no booking is auto-cancelled. A
    booking that no longer fits the restored live hours is flagged instead:
    one `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entry per such booking
    (same as `BlockedTime`'s `keep_new_hours` path). Only bookings on or
    after the pending date are flagged — earlier bookings were never governed
    by the pending generation.
    """

    def delete(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(PROVIDER_ONLY_SCHEDULE_RESPONSE, status=status.HTTP_403_FORBIDDEN)

        today = provider_today(request.user)
        pending_key = discard_pending_generation(request.user, today=today)
        if pending_key is None:
            return Response(
                {"detail": "No pending schedule change."}, status=status.HTTP_404_NOT_FOUND
            )

        # The restored timeline: the live generation governs every date
        # now that the pending rows are gone. Flag only the collisions on
        # or after the discarded date -- those bookings were made under
        # the pending hours.
        rows = list(Availability.objects.filter(provider=request.user))
        current_key = effective_generation_key({row.effective_from for row in rows}, today)
        live_rows = [row for row in rows if row.effective_from == current_key]
        tz = ZoneInfo(request.user.timezone)
        stranded = [
            collision
            for collision in find_schedule_collisions(request.user, [(None, live_rows)])
            if collision["start_time"].astimezone(tz).date() >= pending_key
        ]

        record_audit_event(
            actor=request.user,
            action="cancel:availability_pending_change",
            target_type="availability_schedule",
            target_id=request.user.id,
            metadata={"effective_from": pending_key.isoformat()},
        )
        for collision in stranded:
            record_audit_event(
                actor=request.user,
                action=BOOKING_FLAGGED_AS_EXCEPTION_ACTION,
                target_type="booking",
                target_id=collision["id"],
                metadata={
                    "reason": "pending_schedule_cancelled",
                    "effective_from": pending_key.isoformat(),
                },
            )
        logger.info(
            "pending schedule discarded provider_id=%s effective_from=%s flagged=%s",
            request.user.id,
            pending_key,
            len(stranded),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AppointmentTypeListCreateView(APIView):
    """`GET`/`POST /scheduling/appointment-types` -- a provider's own visit
    types. Same ownership shape as `AvailabilityListView` above."""

    def get(self, request):
        queryset = AppointmentType.objects.filter(provider=request.user)
        return Response(AppointmentTypeSerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(
                {"detail": "Only providers can configure appointment types."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = AppointmentTypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            appointment_type = serializer.save(provider=request.user)
        except IntegrityError:
            return Response(DUPLICATE_APPOINTMENT_TYPE_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

        logger.info(
            "appointment type created id=%s provider_id=%s",
            appointment_type.id,
            request.user.id,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AppointmentTypeDetailView(APIView):
    """`PATCH`/`DELETE /scheduling/appointment-types/<id>`.

    A `PATCH` that changes `duration_minutes` while the type has future
    active bookings is refused with `409 {detail, collisions}` -- the same
    never-silently-strand rule as `ProviderScheduleView`'s hours edit and
    `BlockedTimeListCreateView`'s create: those bookings were made on the
    old slot grid, and a changed grid may no longer contain their start
    times. The provider resolves it themselves (cancel/reschedule the
    listed bookings, or wait them out) and retries; renames are never
    blocked. An accepted duration change writes one audit entry recording
    the old and new lengths.
    """

    permission_classes = [IsOwnerOrAdmin]

    def patch(self, request, pk):
        appointment_type = get_object_or_404(AppointmentType, pk=pk)
        self.check_object_permissions(request, appointment_type)

        serializer = AppointmentTypeSerializer(appointment_type, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        old_duration = appointment_type.duration_minutes
        new_duration = serializer.validated_data.get("duration_minutes")
        duration_changing = new_duration is not None and new_duration != old_duration
        if duration_changing:
            collisions = find_duration_change_collisions(appointment_type)
            if collisions:
                return Response(
                    {
                        "detail": (
                            "This appointment type has upcoming booked appointments "
                            "at its current length. Cancel or reschedule them before "
                            "changing the slot length."
                        ),
                        "collisions": BookingCollisionSerializer(collisions, many=True).data,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        try:
            serializer.save()
        except IntegrityError:
            return Response(DUPLICATE_APPOINTMENT_TYPE_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

        if duration_changing:
            record_audit_event(
                actor=request.user,
                action="update:appointment_type_duration",
                target_type="appointmenttype",
                target_id=appointment_type.id,
                metadata={"duration_from": old_duration, "duration_to": new_duration},
            )
        logger.info("appointment type updated id=%s provider_id=%s", pk, request.user.id)
        return Response(serializer.data)

    def delete(self, request, pk):
        appointment_type = get_object_or_404(AppointmentType, pk=pk)
        self.check_object_permissions(request, appointment_type)
        appointment_type.delete()
        logger.info("appointment type deleted id=%s provider_id=%s", pk, request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BlockedTimeListCreateView(APIView):
    """`GET`/`POST /scheduling/blocked-time` -- a provider's own blocked
    date/time ranges. `GET` returns the requesting user's own rows; `POST`
    creates under `request.user` after checking their role is `provider`.

    Create and delete are written to the audit log (see
    `BlockedTimeDetailView.delete`) on top of `IsOwnerOrAdmin`'s own
    admin-bypass logging — the two record different facts.

    `POST` runs `find_blocked_time_collisions` before writing:

    - No `resolution`, no collision: creates the row, no behavior change.
    - No `resolution`, collision found: nothing created; `409
      {"collisions": [...]}` so the frontend can show the collision modal.
    - `resolution="keep_new_hours"`: creates the row, writes one
      `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entry per affected
      booking. Response includes a `collisions` key.
    - `resolution="cancel_change"`: creates nothing; `200 {"collisions":
      [], "resolution": "cancel_change"}` — a pure acknowledgment.
    """

    def get(self, request):
        queryset = BlockedTime.objects.filter(provider=request.user)
        return Response(BlockedTimeSerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(
                {"detail": "Only providers can block time on their calendar."},
                status=status.HTTP_403_FORBIDDEN,
            )

        resolution_serializer = BlockedTimeResolutionSerializer(data=request.data)
        resolution_serializer.is_valid(raise_exception=True)
        resolution = resolution_serializer.validated_data.get("resolution")

        if resolution == "cancel_change":
            return Response({"collisions": [], "resolution": resolution})

        serializer = BlockedTimeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposed = serializer.validated_data
        collisions = find_blocked_time_collisions(
            request.user, proposed["start"], proposed["end"]
        )

        if collisions and resolution != "keep_new_hours":
            return Response(
                {"collisions": BookingCollisionSerializer(collisions, many=True).data},
                status=status.HTTP_409_CONFLICT,
            )

        blocked_time = serializer.save(provider=request.user)
        record_audit_event(
            actor=request.user,
            action="create:blocked_time",
            target_type="blocked_time",
            target_id=blocked_time.id,
            metadata={
                "start": blocked_time.start.isoformat(),
                "end": blocked_time.end.isoformat(),
            },
        )
        if resolution == "keep_new_hours":
            for collision in collisions:
                record_audit_event(
                    actor=request.user,
                    action=BOOKING_FLAGGED_AS_EXCEPTION_ACTION,
                    target_type="booking",
                    target_id=collision["id"],
                    metadata={"reason": "blocked_time_overlap", "blocked_time_id": blocked_time.id},
                )
        logger.info(
            "blocked time created id=%s provider_id=%s", blocked_time.id, request.user.id
        )

        response_data = dict(serializer.data)
        if resolution == "keep_new_hours":
            response_data["collisions"] = BookingCollisionSerializer(collisions, many=True).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class BlockedTimeDetailView(APIView):
    """`DELETE /scheduling/blocked-time/<id>` -- remove one blocked range."""

    permission_classes = [IsOwnerOrAdmin]

    def delete(self, request, pk):
        blocked_time = get_object_or_404(BlockedTime, pk=pk)
        self.check_object_permissions(request, blocked_time)
        blocked_time.delete()
        record_audit_event(
            actor=request.user,
            action="delete:blocked_time",
            target_type="blocked_time",
            target_id=pk,
        )
        logger.info("blocked time deleted id=%s provider_id=%s", pk, request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProviderListView(APIView):
    """`GET /scheduling/providers` -- every bookable provider. Patient-facing:
    no ownership check, just the project's default `IsAuthenticated` — the
    list is the same for every requesting user.
    """

    def get(self, request):
        providers = User.objects.filter(role=User.Role.PROVIDER).order_by("name", "id")
        return Response(ProviderSerializer(providers, many=True).data)


class ProviderAppointmentTypesView(APIView):
    """`GET /scheduling/providers/<id>/appointment-types` -- one provider's
    visit types, open to any authenticated user. Unlike
    `AppointmentTypeListCreateView` (which is scoped to `request.user`),
    this is keyed off `<id>` in the URL.

    `404` if `<id>` doesn't resolve to a provider. A provider with no types
    configured returns `200` with an empty list (same distinction
    `SlotsView`'s `bookable` flag draws between "no such provider" and "not
    yet bookable").
    """

    def get(self, request, pk):
        provider = get_object_or_404(User, pk=pk, role=User.Role.PROVIDER)
        appointment_types = AppointmentType.objects.filter(provider=provider)
        return Response(AppointmentTypeSerializer(appointment_types, many=True).data)


class SlotsView(APIView):
    """`GET /scheduling/slots?provider_id=&appointment_type_id=&date_from=&date_to=`
    -- computed open slots for a given provider + appointment type over a
    calendar-day range. Patient-facing: no ownership check, just the
    project's default `IsAuthenticated`.
    """

    def get(self, request):
        query = SlotQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data

        try:
            provider = User.objects.get(pk=params["provider_id"], role=User.Role.PROVIDER)
        except User.DoesNotExist:
            return Response({"detail": "Provider not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            appointment_type = AppointmentType.objects.get(
                pk=params["appointment_type_id"], provider=provider
            )
        except AppointmentType.DoesNotExist:
            return Response(
                {"detail": "Appointment type not found for this provider."},
                status=status.HTTP_404_NOT_FOUND,
            )

        base_response = {
            "provider_id": provider.id,
            "appointment_type_id": appointment_type.id,
            "date_from": params["date_from"],
            "date_to": params["date_to"],
        }

        # Empty-state: a provider with no working hours configured at all
        # (not just none in this date range) is "not yet bookable," kept
        # distinct from "bookable, but nothing free this week."
        if not Availability.objects.filter(provider=provider).exists():
            return Response(
                {
                    **base_response,
                    "bookable": False,
                    "reason": "Provider has not configured any working hours yet.",
                    "slots": [],
                }
            )

        # Blocked ranges and confirmed/requested bookings are both just busy
        # intervals — folded into `busy_intervals` at this call site rather
        # than changing `get_open_slots`'s signature (see its module docstring
        # for the seam). Cancelled/completed/no-show bookings are excluded via
        # `Booking.ACTIVE_STATUSES`.
        #
        # Padded a calendar day on each side of the query window before
        # filtering: `start`/`end` are UTC instants but the query range is
        # calendar dates in the *provider's own timezone*, and the widest
        # possible gap between a UTC date boundary and a local one is under
        # 24 hours for any real-world UTC offset. Over-including a blocked
        # row or booking here is harmless -- it just fails every slot's
        # overlap check and is never returned as busy -- so the padding
        # only needs to be generous, not exact.
        padded_start = datetime.combine(
            params["date_from"] - timedelta(days=1), time.min, tzinfo=dt_timezone.utc
        )
        padded_end = datetime.combine(
            params["date_to"] + timedelta(days=1), time.max, tzinfo=dt_timezone.utc
        )
        busy_intervals = [
            (blocked.start, blocked.end)
            for blocked in BlockedTime.objects.filter(
                provider=provider, start__lt=padded_end, end__gt=padded_start
            )
        ] + [
            (booking.start_time, booking.end_time)
            for booking in Booking.objects.filter(
                provider=provider,
                status__in=Booking.ACTIVE_STATUSES,
                start_time__lt=padded_end,
                end_time__gt=padded_start,
            )
        ]
        # A patient already holding an overlapping booking (with any
        # provider) cannot be offered a slot that collides with it -- no
        # overlapping appointments, both axes. Overlap-based rather than
        # start-time-based, so a patient with a 60-minute 09:00 booking is
        # never shown another provider's 09:30 30-minute slot. Other roles
        # browsing this feed are not occupying a patient chair, so they
        # still see the provider's raw open slots.
        if request.user.role == User.Role.PATIENT:
            busy_intervals += [
                (booking.start_time, booking.end_time)
                for booking in Booking.objects.filter(
                    patient=request.user,
                    status__in=Booking.ACTIVE_STATUSES,
                    start_time__lt=padded_end,
                    end_time__gt=padded_start,
                )
            ]

        slots = get_open_slots(
            provider,
            appointment_type,
            params["date_from"],
            params["date_to"],
            busy_intervals=busy_intervals,
        )
        return Response(
            {
                **base_response,
                "bookable": True,
                "reason": None,
                "slots": SlotSerializer(slots, many=True).data,
            }
        )
