"""Collision detection for provider schedule/blocked-time edits against
existing confirmed bookings (architecture.md §2: a provider-availability
edit that would strand a confirmed booking is flagged rather than silently
applied).

`find_schedule_collisions` and `find_blocked_time_collisions` are pure read
functions: given a provider and a *proposed* change not yet written, they
return which currently-active `Booking` rows within a forward horizon would
no longer fit. Neither function writes anything — see
`ProviderScheduleView.put` and `BlockedTimeListCreateView.post` for where
the result becomes a `409` or an accepted-with-audit response.
"""

from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone as django_timezone

from bookings.models import Booking

from .schedule import effective_generation_key, window_field

# How far ahead to check for collisions. Intentionally separate from
# `scheduling.slots.MAX_SLOT_QUERY_RANGE_DAYS` — that caps a single
# patient-facing slot query; this caps how far ahead a provider edit is
# checked, and the two don't need to be equal.
DEFAULT_HORIZON_DAYS = 133


def _as_collision(booking) -> dict:
    """Shape for the frontend affected-appointments list (no extra queries)."""
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


def _is_covered(local_start, local_end, windows) -> bool:
    """Whether a booking's provider-local span falls entirely inside one of
    `windows`. A booking whose local start/end fall on two different
    calendar dates (crossing local midnight) can never be "inside" a
    same-day `Availability` window and always collides -- consistent with
    `scheduling.slots.get_open_slots`, which never generates a slot that
    spans midnight either."""
    if local_start.date() != local_end.date():
        return False
    for window in windows:
        start_time = window_field(window, "start_time")
        end_time = window_field(window, "end_time")
        if start_time <= local_start.time() and local_end.time() <= end_time:
            return True
    return False


def find_schedule_collisions(
    provider, generations, *, horizon_days=DEFAULT_HORIZON_DAYS, now=None
):
    """Given a *complete* proposed schedule timeline -- an iterable of
    `(effective_from, windows)` generation pairs, exactly what
    `scheduling.schedule.proposed_timeline` builds -- return every active
    booking in the next `horizon_days` whose local day-of-week + time span
    no longer falls fully inside a window of the generation governing its
    date.

    Each booking is checked against the generation effective on *its own*
    provider-local start date (`effective_generation_key`), so editing the
    live hours while a pending change exists never falsely flags a booking
    that the pending generation still covers, and vice versa.

    `windows` entries are `{day_of_week, start_time, end_time}` dicts
    (`ScheduleWindowSerializer.validated_data`) or `Availability` rows.
    Passing the full weekly picture per generation, not a diff, is
    deliberate: a day simply absent from a generation's windows means "no
    working hours that day".
    """
    if now is None:
        now = django_timezone.now()

    generation_keys = []
    windows_by_generation: dict = {}
    for key, windows in generations:
        generation_keys.append(key)
        by_weekday: dict[int, list] = {}
        for window in windows:
            by_weekday.setdefault(window_field(window, "day_of_week"), []).append(window)
        windows_by_generation[key] = by_weekday

    tz = ZoneInfo(provider.timezone)

    collisions = []
    for booking in _active_bookings_in_horizon(provider, horizon_days=horizon_days, now=now):
        local_start = booking.start_time.astimezone(tz)
        local_end = booking.end_time.astimezone(tz)
        key = effective_generation_key(generation_keys, local_start.date())
        windows = windows_by_generation.get(key, {}).get(local_start.weekday(), [])
        if not _is_covered(local_start, local_end, windows):
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
