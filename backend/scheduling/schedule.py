"""Schedule generations -- the model behind `GET`/`PUT /scheduling/schedule`.

A provider's `Availability` rows partition into *generations* keyed by
`effective_from` (see `scheduling/models.py`): the schedule in effect on
provider-local date `D` is the generation with the greatest
`effective_from <= D`, treating `NULL` as `-infinity` (the baseline). The
deferred "new hours from date X" switch is therefore a pure read-time
computation -- no promotion job, no scheduler; `effective_generation_key`
below is that one rule, shared by `scheduling/slots.py`,
`scheduling/collisions.py`, and the views.

Everything date-shaped here is a *calendar date in `provider.timezone`*
("clinic time"), never a UTC date -- `provider_today` is the only place
"today" is ever derived, so the whole feature agrees on when a pending
generation starts applying.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone as django_timezone

from .models import Availability

WINDOW_ORDER_ERROR = "End time must be after start time."
WINDOW_OVERLAP_ERROR = "Blocks on the same day can't overlap."
WINDOW_GAP_ERROR = "Blocks on the same day must be at least 1 hour apart."
EFFECTIVE_FROM_ERROR = "Effective date must be a future date in your timezone."

# Two blocks on the same day must be separated by at least this much --
# exactly one hour counts as valid (12:00 -> 13:00 ok), touching blocks
# (12:00 / 12:00) don't.
MIN_BLOCK_GAP = timedelta(hours=1)


def provider_today(provider) -> date:
    """Today as a calendar date in the provider's own timezone -- the date
    every `effective_from` comparison is made against, never the browser's
    or the server's UTC date."""
    return django_timezone.now().astimezone(ZoneInfo(provider.timezone)).date()


def effective_generation_key(keys, local_date):
    """Which generation governs `local_date`: the greatest `effective_from`
    that is `<= local_date`, with `None` (the baseline) as `-infinity`.

    Returns `None` both for "the baseline governs" and for "no dated
    generation applies yet" -- deliberately the same answer, because the
    baseline may legitimately have zero rows (a provider who cleared all
    hours), and an empty generation is still the one in effect.
    """
    dated = [key for key in keys if key is not None and key <= local_date]
    return max(dated) if dated else None


def window_field(window, name):
    """Windows arrive as dicts (`ScheduleWindowSerializer.validated_data`)
    or `Availability` rows (an existing generation folded into a proposed
    timeline) -- callers shouldn't have to care which."""
    return window[name] if isinstance(window, dict) else getattr(window, name)


def _minutes_between(earlier, later):
    anchor = date(2000, 1, 1)
    return datetime.combine(anchor, later) - datetime.combine(anchor, earlier)


def validate_weekly_windows(windows) -> dict[str, list[str]]:
    """Validate one complete weekly window set against the three
    schedule rules: per day, `end > start`, no overlaps, and >= 1 hour
    between the end of one block and the start of the next.

    Returns `{}` when valid, otherwise `{day_index: [messages]}` with
    string day keys -- exactly the shape `PUT /scheduling/schedule`'s 400
    body nests under `"windows"`, so the client can render each message
    inline on the offending day. Each rule appears at most once per day.
    """
    errors: dict[str, list[str]] = {}

    def add(day, message):
        messages = errors.setdefault(str(day), [])
        if message not in messages:
            messages.append(message)

    by_day: dict[int, list] = {}
    for window in windows:
        by_day.setdefault(window_field(window, "day_of_week"), []).append(window)

    for day, day_windows in sorted(by_day.items()):
        ordered = []
        for window in day_windows:
            start = window_field(window, "start_time")
            end = window_field(window, "end_time")
            if start >= end:
                add(day, WINDOW_ORDER_ERROR)
            else:
                ordered.append((start, end))
        ordered.sort()
        for (_, previous_end), (next_start, _) in zip(ordered, ordered[1:]):
            if next_start < previous_end:
                add(day, WINDOW_OVERLAP_ERROR)
            elif _minutes_between(previous_end, next_start) < MIN_BLOCK_GAP:
                add(day, WINDOW_GAP_ERROR)

    return errors


def get_provider_schedule(provider) -> dict:
    """The `GET /scheduling/schedule` payload: the generation effective
    today (`current`) plus the one future-dated generation if any
    (`pending`). Reads apply the general selection rule rather than
    assuming a normalized table, so a pending generation whose date has
    already passed correctly reads as `current` (with its start date as
    `effective_from`) until the next write normalizes it away.
    """
    today = provider_today(provider)
    rows = list(Availability.objects.filter(provider=provider))
    keys = {row.effective_from for row in rows}

    current_key = effective_generation_key(keys, today)
    future_keys = sorted(key for key in keys if key is not None and key > today)
    # At most one pending generation is an application-level invariant
    # (`replace_generation` deletes every future generation before writing
    # a new one); `min` keeps the read deterministic even against
    # hand-written data that violates it.
    pending_key = future_keys[0] if future_keys else None

    def generation(key):
        return {
            "effective_from": key,
            "windows": [row for row in rows if row.effective_from == key],
        }

    return {
        "timezone": provider.timezone,
        "today": today,
        "current": generation(current_key),
        "pending": generation(pending_key) if pending_key is not None else None,
    }


def proposed_timeline(provider, windows, effective_from, *, today):
    """The list of `(effective_from, windows)` generations that would exist
    after writing `windows` at `effective_from` -- what
    `find_schedule_collisions` checks bookings against.

    - `effective_from is None` replaces the currently-effective generation
      and leaves any pending one in place.
    - A future date creates/replaces *the* pending generation (there is
      only ever one) and leaves the live windows untouched.
    """
    rows = list(Availability.objects.filter(provider=provider))
    keys = {row.effective_from for row in rows}
    current_key = effective_generation_key(keys, today)

    if effective_from is None:
        timeline = [(None, list(windows))]
        for key in sorted(key for key in keys if key is not None and key > today):
            timeline.append((key, [row for row in rows if row.effective_from == key]))
        return timeline

    current_rows = [row for row in rows if row.effective_from == current_key]
    return [(None, current_rows), (effective_from, list(windows))]


def earliest_safe_date(collisions, *, provider, today, generation_keys, target_key):
    """The `min`/default for the deferral date picker: the day after the
    latest colliding booking's provider-local *end* date, floored at
    `today + 1`.

    `None` when deferring the written change cannot clear every collision
    -- i.e. some colliding booking's date is governed by a generation
    *other* than the one being written (e.g. an immediate edit whose
    conflicts sit past an existing pending date). Moving the written
    generation's date then never rescues that booking.
    """
    tz = ZoneInfo(provider.timezone)
    latest_end = None
    for collision in collisions:
        local_start_date = collision["start_time"].astimezone(tz).date()
        if effective_generation_key(generation_keys, local_start_date) != target_key:
            return None
        local_end_date = collision["end_time"].astimezone(tz).date()
        if latest_end is None or local_end_date > latest_end:
            latest_end = local_end_date
    return max(latest_end + timedelta(days=1), today + timedelta(days=1))


def discard_pending_generation(provider, *, today):
    """Delete the pending generation's rows -- every row dated strictly
    after `today` (`replace_generation` keeps at most one such generation;
    hand-written extras are swept along with it). The live generation is
    untouched. Returns the discarded `effective_from` (the earliest future
    date, matching what `get_provider_schedule` reads as `pending`), or
    `None` -- deleting nothing -- when no generation is pending.
    """
    pending = Availability.objects.filter(provider=provider, effective_from__gt=today)
    keys = sorted(set(pending.values_list("effective_from", flat=True)))
    if not keys:
        return None
    pending.delete()
    return keys[0]


def replace_generation(provider, windows, effective_from, *, today):
    """Atomically replace one whole generation with `windows`.

    Inside one transaction (whole-schedule replace -- there is no
    partial-failure state, unlike the retired per-day DELETE-then-POST
    sequence):

    1. Normalize: delete every generation older than the currently
       effective one, then collapse the effective one's `effective_from`
       to `NULL`. Steady state after any write is therefore at most two
       generations -- `NULL` (live) and one future date (pending).
    2. Delete the target generation's rows: the live (`NULL`) rows for an
       immediate apply, or *every* future-dated row for a deferred one
       (one pending at a time -- a new date replaces the old pending).
    3. `bulk_create` the new rows under `effective_from`.

    Collision checking is deliberately not here -- the caller runs
    `find_schedule_collisions` against `proposed_timeline` first and never
    calls this when it would strand a booking.
    """
    with transaction.atomic():
        rows = Availability.objects.filter(provider=provider)
        keys = set(rows.values_list("effective_from", flat=True))
        current_key = effective_generation_key(keys, today)

        if current_key is not None:
            rows.filter(effective_from__lt=current_key).delete()
            rows.filter(effective_from__isnull=True).delete()
            rows.filter(effective_from=current_key).update(effective_from=None)

        if effective_from is None:
            rows.filter(effective_from__isnull=True).delete()
        else:
            rows.filter(effective_from__gt=today).delete()

        Availability.objects.bulk_create(
            Availability(
                provider=provider,
                day_of_week=window_field(window, "day_of_week"),
                start_time=window_field(window, "start_time"),
                end_time=window_field(window, "end_time"),
                effective_from=effective_from,
            )
            for window in windows
        )
