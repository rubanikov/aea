import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AppointmentType, Availability
from .serializers import (
    AppointmentTypeSerializer,
    AvailabilitySerializer,
    SlotQuerySerializer,
    SlotSerializer,
)
from .slots import get_open_slots

User = get_user_model()
logger = logging.getLogger(__name__)

DUPLICATE_APPOINTMENT_TYPE_RESPONSE = {
    "name": ["An appointment type with this name already exists."]
}

# TICKET-03 integration note (applies to every ownership check in this
# file): these are manual `request.user == <row>.provider` checks and a
# manual `request.user.role == PROVIDER` check, per this ticket's brief --
# TICKET-03 is building a reusable ownership-check permission class (and an
# audit-log write helper) in a sibling `audit` app / `accounts.permissions`
# in parallel, and wasn't guaranteed to exist yet while this app was built.
# Once both are merged, swap the manual checks below for that utility and
# add the audit-log write it wires up, rather than leaving these as the
# permanent pattern.


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

    def _get_owned_or_404(self, request, pk):
        try:
            availability = Availability.objects.get(pk=pk)
        except Availability.DoesNotExist:
            return None
        if availability.provider_id != request.user.id:
            return None
        return availability

    def delete(self, request, pk):
        availability = self._get_owned_or_404(request, pk)
        if availability is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        availability.delete()
        logger.info("availability deleted id=%s provider_id=%s", pk, request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


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

    def _get_owned_or_404(self, request, pk):
        try:
            appointment_type = AppointmentType.objects.get(pk=pk)
        except AppointmentType.DoesNotExist:
            return None
        if appointment_type.provider_id != request.user.id:
            return None
        return appointment_type

    def patch(self, request, pk):
        appointment_type = self._get_owned_or_404(request, pk)
        if appointment_type is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = AppointmentTypeSerializer(appointment_type, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
        except IntegrityError:
            return Response(DUPLICATE_APPOINTMENT_TYPE_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

        logger.info("appointment type updated id=%s provider_id=%s", pk, request.user.id)
        return Response(serializer.data)

    def delete(self, request, pk):
        appointment_type = self._get_owned_or_404(request, pk)
        if appointment_type is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        appointment_type.delete()
        logger.info("appointment type deleted id=%s provider_id=%s", pk, request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


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

        slots = get_open_slots(
            provider, appointment_type, params["date_from"], params["date_to"]
        )
        return Response(
            {
                **base_response,
                "bookable": True,
                "reason": None,
                "slots": SlotSerializer(slots, many=True).data,
            }
        )
