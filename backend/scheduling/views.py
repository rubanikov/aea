import logging
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.permissions import IsOwnerOrAdmin
from audit.services import record_audit_event
from bookings.models import Booking

from .collisions import find_availability_collisions, find_blocked_time_collisions
from .models import AppointmentType, Availability, BlockedTime
from .serializers import (
    AppointmentTypeSerializer,
    AvailabilityCollisionCheckSerializer,
    AvailabilitySerializer,
    BlockedTimeResolutionSerializer,
    BlockedTimeSerializer,
    BookingCollisionSerializer,
    ProviderSerializer,
    SlotQuerySerializer,
    SlotSerializer,
)
from .slots import get_open_slots

# TICKET-11 (edge case 3): the audit action every "provider edit accepted
# despite orphaning a booking" write uses, for both the `Availability` and
# `BlockedTime` paths below -- a shared string so a reviewer scanning the
# audit log for this event doesn't have to know which of the two edit types
# caused it.
BOOKING_FLAGGED_AS_EXCEPTION_ACTION = "availability_change:booking_flagged_as_exception"

User = get_user_model()
logger = logging.getLogger(__name__)

DUPLICATE_APPOINTMENT_TYPE_RESPONSE = {
    "name": ["An appointment type with this name already exists."]
}

# TICKET-05 retrofit: the manual `request.user == <row>.provider` ownership
# checks this file used to have on its detail views (per TICKET-04's note,
# deferred until TICKET-03's `audit.permissions.IsOwnerOrAdmin` existed) are
# now `IsOwnerOrAdmin` below on `AvailabilityDetailView`/
# `AppointmentTypeDetailView`/`BlockedTimeDetailView`. The list/create views
# keep their own manual `request.user.role == PROVIDER` check and
# owner-scoped `GET` queryset -- there's no existing *object* for
# `IsOwnerOrAdmin`'s `has_object_permission` to check against on creation,
# and the list `GET` was never an ownership check to begin with, just a
# queryset filter.
#
# One real behavior change from the retrofit: a cross-provider `DELETE`/
# `PATCH` against another provider's row now returns 403 (DRF's normal
# `has_object_permission` denial), not 404. `IsOwnerOrAdmin` doesn't hide
# row existence the way the old manual check did (see its docstring) --
# hiding existence would also have to hide it from admins, defeating the
# bypass this retrofit exists to add.


class AvailabilityListCreateView(APIView):
    """`GET`/`POST /scheduling/availability` -- a provider's own recurring
    weekly working hours. `GET` only ever returns the requesting user's own
    rows; `POST` always creates under `request.user` after checking their
    role is `provider`.
    """

    def get(self, request):
        queryset = Availability.objects.filter(provider=request.user)
        return Response(AvailabilitySerializer(queryset, many=True).data)

    def post(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(
                {"detail": "Only providers can configure working hours."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        availability = serializer.save(provider=request.user)
        logger.info(
            "availability created id=%s provider_id=%s", availability.id, request.user.id
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AvailabilityDetailView(APIView):
    """`DELETE /scheduling/availability/<id>` -- one availability row.

    Not in TICKET-04's literal three-endpoint list (which only names
    `GET`/`POST /scheduling/availability`), added because a weekly-hours
    form that can only ever add rows and never remove a mistake isn't
    usable. Flagged in this ticket's handoff notes for the frontend
    builder / orchestrator to confirm.
    """

    permission_classes = [IsOwnerOrAdmin]

    def delete(self, request, pk):
        availability = get_object_or_404(Availability, pk=pk)
        self.check_object_permissions(request, availability)
        availability.delete()
        logger.info("availability deleted id=%s provider_id=%s", pk, request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AvailabilityCollisionCheckView(APIView):
    """`POST /scheduling/availability/check-collisions` -- TICKET-11, edge
    case 3 ("provider edits availability that collides with an existing
    confirmed booking"). Detection-only: this view never creates or deletes
    an `Availability` row itself -- the frontend still does that through the
    existing per-row `AvailabilityListCreateView`/`AvailabilityDetailView`
    endpoints above, exactly as `WorkingHoursSection.tsx` already does
    (delete-and-recreate per changed day, per TICKET-05's summary).

    Why a dedicated endpoint rather than checking inside the per-row
    `POST`/`DELETE` directly: `Availability` has no bulk endpoint (TICKET-
    04's deliberate design), so a shrink-hours save is a *sequence* of
    DELETE-then-POST calls, one pair per changed day. Checking collisions on
    any single call in that sequence in isolation is actively wrong, not
    just incomplete -- at the moment a "shrink Monday" DELETE runs, the
    replacement POST for the narrower Monday window hasn't landed yet, so
    every active Monday booking would look orphaned even when the *final*,
    post-save hours still cover it fine. The only point that has the true,
    complete proposed picture is before that sequence starts, which is
    exactly what this endpoint is for: the frontend calls it once with the
    *entire* desired weekly state (every window that will exist once the
    save finishes -- a day simply missing from `windows` means "no hours
    that day", covering the "delete a day entirely" case too), gets back the
    real answer, and only then runs its existing per-row save sequence --
    which stays completely unguarded and unchanged on purpose. The tradeoff:
    this is a client/backend *contract*, not a per-row DB-level invariant --
    a client that skips this endpoint and calls the per-row `POST`/`DELETE`
    directly gets no collision protection. Documented, not silently assumed
    (see this ticket's handoff notes).

    Body (detection -- no `resolution`): `{"windows": [{"day_of_week",
    "start_time", "end_time"}, ...]}`. `200 {"collisions": []}` if none;
    `409 {"collisions": [...]}` (see `BookingCollisionSerializer`) if the
    proposed set would orphan a booking -- nothing is written either way.

    Body (resolution -- the second call after the frontend shows the modal
    and the provider picks one of its two options): add `"resolution":
    "keep_new_hours"` or `"cancel_change"`.
    - `"keep_new_hours"` writes one audit entry per affected booking (the
      record of it becoming a flagged exception -- see
      `BOOKING_FLAGGED_AS_EXCEPTION_ACTION`) and returns `200 {"collisions":
      [...], "resolution": "keep_new_hours"}`. The frontend then runs its
      normal per-row save sequence to actually persist `windows`.
    - `"cancel_change"` writes nothing and returns `200 {"collisions": [],
      "resolution": "cancel_change"}` -- a pure acknowledgment. The frontend
      is equally free to just close the modal client-side and never call
      this again for that choice, since there is nothing to undo (the
      per-row save sequence never ran) -- this project takes the "call it
      anyway" branch so the choice is always logged the same way regardless
      of which one the provider picks, and so the frontend has one uniform
      response shape to handle for both buttons on the modal.
    """

    def post(self, request):
        if request.user.role != User.Role.PROVIDER:
            return Response(
                {"detail": "Only providers can configure working hours."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = AvailabilityCollisionCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        windows = serializer.validated_data["windows"]
        resolution = serializer.validated_data.get("resolution")

        if resolution == "cancel_change":
            return Response({"collisions": [], "resolution": resolution})

        collisions = find_availability_collisions(request.user, windows)

        if resolution == "keep_new_hours":
            for collision in collisions:
                record_audit_event(
                    actor=request.user,
                    action=BOOKING_FLAGGED_AS_EXCEPTION_ACTION,
                    target_type="booking",
                    target_id=collision["id"],
                    metadata={"reason": "availability_shrink"},
                )
            return Response(
                {
                    "collisions": BookingCollisionSerializer(collisions, many=True).data,
                    "resolution": resolution,
                }
            )

        if collisions:
            return Response(
                {"collisions": BookingCollisionSerializer(collisions, many=True).data},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"collisions": []})


class AppointmentTypeListCreateView(APIView):
    """`GET`/`POST /scheduling/appointment-types` -- a provider's own visit
    types. Same ownership shape as `AvailabilityListCreateView` above."""

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
    """`PATCH`/`DELETE /scheduling/appointment-types/<id>`."""

    permission_classes = [IsOwnerOrAdmin]

    def patch(self, request, pk):
        appointment_type = get_object_or_404(AppointmentType, pk=pk)
        self.check_object_permissions(request, appointment_type)

        serializer = AppointmentTypeSerializer(appointment_type, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
        except IntegrityError:
            return Response(DUPLICATE_APPOINTMENT_TYPE_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

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
    date/time ranges (TICKET-05). Same ownership shape as
    `AvailabilityListCreateView` above: `GET` only ever returns the
    requesting user's own rows, `POST` always creates under `request.user`
    after checking their role is `provider`.

    Unlike `Availability`/`AppointmentType`, create and delete here are also
    written to the audit log (see `BlockedTimeDetailView.delete` below) --
    per this ticket's brief, blocking time is exactly the kind of
    booking-adjacent state change TICKET-03's audit trail exists for. This
    is on top of (not instead of) the admin-bypass logging
    `IsOwnerOrAdmin` already does on its own on the detail view -- the two
    log different facts: one that an admin used the bypass, one that the
    row itself was created/deleted.

    `POST` is also TICKET-11's (edge case 3) second collision-guarded edit
    path, alongside `AvailabilityCollisionCheckView` above -- but unlike
    `Availability`, no dedicated endpoint is needed here. A block is a
    single create per range (there's no per-row-in-a-sequence problem: one
    `POST` *is* the entire proposed change), so this `POST` itself runs
    `find_blocked_time_collisions` before creating anything:

    - No `resolution` field, no collision: creates the row exactly as
      before this ticket -- zero behavior change for the common case.
    - No `resolution` field, collision found: nothing is created; `409
      {"collisions": [...]}` (see `BookingCollisionSerializer`) so the
      frontend can show the collision modal.
    - `resolution="keep_new_hours"`: creates the row for real (skips the
      collision check that would otherwise block it -- the caller already
      saw and accepted the collisions) and writes one audit entry per
      affected booking (`BOOKING_FLAGGED_AS_EXCEPTION_ACTION`). Response is
      the created row plus a `collisions` key.
    - `resolution="cancel_change"`: creates nothing; `200 {"collisions": [],
      "resolution": "cancel_change"}` -- a pure acknowledgment, same "the
      frontend may skip calling this" note as
      `AvailabilityCollisionCheckView`.
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
    """`GET /scheduling/providers` -- every bookable provider (TICKET-06:
    a patient needs to discover *who* they can book with before they can
    ask `SlotsView` below for that provider's open slots). Patient-facing
    like `SlotsView`: no ownership check, just the project's default
    `IsAuthenticated` -- there's no owner to scope this list to, it's the
    same list for every requesting user.
    """

    def get(self, request):
        providers = User.objects.filter(role=User.Role.PROVIDER).order_by("name", "id")
        return Response(ProviderSerializer(providers, many=True).data)


class ProviderAppointmentTypesView(APIView):
    """`GET /scheduling/providers/<id>/appointment-types` -- one provider's
    visit types (TICKET-06: a patient needs to know what services a
    provider offers, and each one's duration, before requesting slots for
    one via `SlotsView` below). Unlike `AppointmentTypeListCreateView`
    above -- which is owner-scoped to `request.user` for a provider
    managing their own types -- this is keyed off the `<id>` in the URL and
    open to any authenticated user, the same "browsing is the point" shape
    as `SlotsView`.

    `404`s if `<id>` doesn't resolve to a provider at all -- a provider
    that exists but simply hasn't configured any types yet is a `200` with
    an empty list, same distinction `SlotsView`'s `bookable` flag draws
    between "no such provider" and "not yet bookable".
    """

    def get(self, request, pk):
        provider = get_object_or_404(User, pk=pk, role=User.Role.PROVIDER)
        appointment_types = AppointmentType.objects.filter(provider=provider)
        return Response(AppointmentTypeSerializer(appointment_types, many=True).data)


class SlotsView(APIView):
    """`GET /scheduling/slots?provider_id=&appointment_type_id=&date_from=&date_to=`
    -- computed open slots for a given provider + appointment type over a
    calendar-day range. Patient-facing: no ownership check (browsing a
    provider's bookable slots is the point -- TICKET-06 builds the real
    patient booking flow on top of this), just the project's default
    `IsAuthenticated`.
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
        # (not just none in this date range) is "not yet bookable" -- this
        # ticket's brief calls this out explicitly rather than letting it
        # look identical to "bookable, but nothing free this week."
        if not Availability.objects.filter(provider=provider).exists():
            return Response(
                {
                    **base_response,
                    "bookable": False,
                    "reason": "Provider has not configured any working hours yet.",
                    "slots": [],
                }
            )

        # TICKET-05: a provider's blocked ranges are conceptually just
        # another busy interval (see scheduling/slots.py's module
        # docstring) -- folded into `busy_intervals` here at the call site
        # rather than changing `get_open_slots`'s own signature, exactly as
        # that seam was designed for. TICKET-07: real `Booking` rows are
        # folded in the same way, right below -- a confirmed/requested
        # booking disappears from this list exactly like a blocked range
        # does; a cancelled/completed/no-show one never blocked it to begin
        # with (see `Booking.ACTIVE_STATUSES`).
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
