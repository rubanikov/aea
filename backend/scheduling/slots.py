"""Slot-generation engine — architecture.md §2 ("compute slots, don't store
them") and §5 (UTC storage + a per-actor IANA timezone, DST-safe via
`zoneinfo`).

`get_open_slots` computes every bookable slot fresh from `Availability` on
every call; no slot is ever a persisted row.

`busy_intervals` is the seam for booked time: a plain iterable of `(start,
end)` tz-aware UTC `datetime` pairs. `SlotsView` and
`bookings.services.create_booking` fold real `Booking` rows in at their call
sites — this module has no import of, or knowledge about, `bookings`. The
only contract is "something reducible to (start, end) UTC instant pairs."
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.utils import timezone as django_timezone

from .schedule import effective_generation_key

# Safety cap for the patient-facing `GET /scheduling/slots` endpoint (see
# scheduling/serializers.py) -- keeps a query from generating an unbounded
# number of slots against an arbitrarily large date range.
MAX_SLOT_QUERY_RANGE_DAYS = 60


@dataclass(frozen=True)
class Slot:
    """One bookable window. `start`/`end` are always tz-aware UTC
    `datetime`s -- never naive, never local (architecture.md §5)."""

    start: datetime
    end: datetime


def _overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def get_open_slots(
    provider,
    appointment_type,
    date_from: date,
    date_to: date,
    busy_intervals=(),
    now: datetime | None = None,
) -> list[Slot]:
    """Compute open slots for `provider`, sized to
    `appointment_type.duration_minutes`, across the inclusive calendar-day
    range `[date_from, date_to]`.

    - Reads `provider.availability_windows` (recurring day-of-week +
      wall-clock time-of-day rows) and resolves each one, per calendar date,
      to a UTC instant pair using `provider.timezone` via `zoneinfo` --
      never naive local arithmetic.
    - Per calendar date, only the schedule *generation* effective on that
      date contributes windows (`scheduling.schedule.effective_generation_key`
      -- the greatest `effective_from <= date`, `NULL` as the baseline).
      Dates before a pending change's `effective_from` use the live hours;
      dates on/after it use the pending ones -- this read-time selection
      *is* the deferred switch, there is no promotion job.
    - Discretizes each resolved window into consecutive
      `appointment_type.duration_minutes` slots. The discretization loop
      itself runs entirely on the two already-UTC endpoints: each endpoint
      is resolved to its own correct UTC instant *before* the loop starts,
      so a window whose local wall-clock span crosses a DST transition
      still produces exactly the right number of slots -- UTC has no gaps
      or repeats for the loop to trip over, whatever the local clock did.
    - Subtracts `busy_intervals` (see module docstring for the injection
      seam).
    - Drops any slot starting before `now` (defaults to
      `django.utils.timezone.now()`), so past times are never returned as
      bookable.

    Returns slots ordered by start time. Pure aside from the
    `availability_windows` read and `now`'s default -- callers pass in
    already-loaded `provider`/`appointment_type` and an already-computed
    `busy_intervals`, so there are no other reads and no writes.
    """
    if now is None:
        now = django_timezone.now()

    tz = ZoneInfo(provider.timezone)
    duration = timedelta(minutes=appointment_type.duration_minutes)

    windows_by_generation: dict[date | None, dict[int, list]] = {}
    for window in provider.availability_windows.all():
        windows_by_generation.setdefault(window.effective_from, {}).setdefault(
            window.day_of_week, []
        ).append(window)
    generation_keys = list(windows_by_generation)

    slots: list[Slot] = []
    day = date_from
    while day <= date_to:
        generation = windows_by_generation.get(
            effective_generation_key(generation_keys, day), {}
        )
        for window in generation.get(day.weekday(), []):
            window_start_utc = datetime.combine(day, window.start_time, tzinfo=tz).astimezone(
                dt_timezone.utc
            )
            window_end_utc = datetime.combine(day, window.end_time, tzinfo=tz).astimezone(
                dt_timezone.utc
            )
            slot_start = window_start_utc
            while slot_start + duration <= window_end_utc:
                slot_end = slot_start + duration
                slots.append(Slot(start=slot_start, end=slot_end))
                slot_start = slot_end
        day += timedelta(days=1)

    slots = [slot for slot in slots if slot.start >= now]
    slots = [
        slot
        for slot in slots
        if not any(
            _overlaps(slot.start, slot.end, busy_start, busy_end)
            for busy_start, busy_end in busy_intervals
        )
    ]
    return slots
