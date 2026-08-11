"""Collision detection for provider availability/blocked-time edits against
existing confirmed bookings -- TICKET-11, project.md edge case 3 ("Provider
edits availability that collides with an already-booked slot ... the booked
appointment is protected -- it is never silently deleted or double-booked")
and architecture.md §2 ("A provider-availability edit that would collide
with an existing confirmed Booking should be flagged ... rather than
silently applied").

`find_availability_collisions` and `find_blocked_time_collisions` are pure
read functions: given a provider and a *proposed* change that has not been
applied yet, they return which currently-active `Booking` rows within a
forward horizon would no longer be covered by the new availability, or
would newly overlap the proposed blocked range. Neither function writes
anything -- see `scheduling/views.py`'s `AvailabilityCollisionCheckView`
and `BlockedTimeListCreateView.post` for where the result becomes a `409`
or an accepted-with-audit response.
"""

from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone as django_timezone

from bookings.models import Booking

# "next 90 days" -- the ticket's own suggested cap, so a collision check
# against a provider with years of future bookings never scans unbounded
# history. Matches the spirit of `scheduling.slots.MAX_SLOT_QUERY_RANGE_DAYS`
# without reusing that exact constant -- that one bounds a single patient
# -facing slot query, this one bounds how far ahead a provider's own edit
# is checked, and there's no reason the two should be forced to match.
DEFAULT_HORIZON_DAYS = 90


def _as_collision(booking) -> dict:
    """One entry of the shape the frontend's affected-appointments list
    needs. Reads only fields off `booking.patient`/`booking.appointment_type`
    that the two finder functions below always `select_related` -- never a
    fresh query per booking.
    """
    return {
        "id": booking.id,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "patient_name": booking.patient.name,
        "appointment_type_name": booking.appointment_type.name,
        "status": booking.status,
    }


def _active_bookings_in_horizon(provider, *, horizon_days, now):
    horizon_end = now + timedelta(days=horizon_days)
    return (
        Booking.objects.filter(
            provider=provider,
            status__in=Booking.ACTIVE_STATUSES,
            start_time__gte=now,
            start_time__lt=horizon_end,
        )
        .select_related("patient", "appointment_type")
        .order_by("start_time")
    )


def _window_field(window, name):
    """`proposed_windows` entries may be plain dicts (the shape
    `AvailabilityCollisionCheckSerializer.validated_data` produces) or
    `Availability` model instances -- callers shouldn't have to care which."""
    return window[name] if isinstance(window, dict) else getattr(window, name)


def find_availability_collisions(
    provider, proposed_windows, *, horizon_days=DEFAULT_HORIZON_DAYS, now=None
):
    """Given the *complete* proposed weekly `Availability` picture (every
    window that would exist once the edit is saved -- a day simply absent
    from `proposed_windows` means "no working hours that day"), return every
    active booking in the next `horizon_days` whose local day-of-week + time
    span no longer falls fully inside one of those windows.

    `proposed_windows` is a plain iterable of `{day_of_week, start_time,
    end_time}` dicts (`day_of_week` matching `Availability.DayOfWeek`,
    `start_time`/`end_time` plain `datetime.time`s) -- exactly the shape
    `AvailabilityCollisionCheckSerializer` validates into. Passing the full
    set, not a diff, is deliberate: see `scheduling/views.py`'s
    `AvailabilityCollisionCheckView` docstring for why a single changed row
    can't be checked in isolation.

    A booking whose local start/end fall on two different calendar dates
    (crossing local midnight) can never be "inside" a same-day
    `Availability` window and always collides -- consistent with
    `scheduling.slots.get_open_slots`, which never generates a slot that
    spans midnight either.
    """
    if now is None:
        now = django_timezone.now()

    windows_by_weekday: dict[int, list] = {}
    for window in proposed_windows:
        windows_by_weekday.setdefault(_window_field(window, "day_of_week"), []).append(window)

    tz = ZoneInfo(provider.timezone)

    def _is_covered(local_start, local_end) -> bool:
        if local_start.date() != local_end.date():
            return False
        for window in windows_by_weekday.get(local_start.weekday(), []):
            start_time = _window_field(window, "start_time")
            end_time = _window_field(window, "end_time")
            if start_time <= local_start.time() and local_end.time() <= end_time:
                return True
        return False

    collisions = []
    for booking in _active_bookings_in_horizon(provider, horizon_days=horizon_days, now=now):
        local_start = booking.start_time.astimezone(tz)
        local_end = booking.end_time.astimezone(tz)
        if not _is_covered(local_start, local_end):
            collisions.append(_as_collision(booking))
    return collisions


def find_blocked_time_collisions(
    provider, start, end, *, horizon_days=DEFAULT_HORIZON_DAYS, now=None
):
    """Given a proposed new (or edited) `BlockedTime` range `[start, end)`
    (tz-aware UTC `datetime`s), return every active booking in the next
    `horizon_days` whose `[start_time, end_time)` overlaps it.
    """
    if now is None:
        now = django_timezone.now()
    horizon_end = now + timedelta(days=horizon_days)

    bookings = (
        Booking.objects.filter(
            provider=provider,
            status__in=Booking.ACTIVE_STATUSES,
            start_time__gte=now,
            start_time__lt=min(end, horizon_end),
            end_time__gt=start,
        )
        .select_related("patient", "appointment_type")
        .order_by("start_time")
    )
    return [_as_collision(booking) for booking in bookings]
