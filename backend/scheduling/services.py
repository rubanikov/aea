"""Provider working-hours write path -- the orchestration behind
`PUT /scheduling/schedule`.

`schedule.py` owns the primitives (window validation, generation
selection, the atomic replace) and `collisions.py` owns the booked-slot
scan; this module strings them together in the order the endpoint's
contract requires and raises typed exceptions the view maps to HTTP.
Same shape as `bookings/services.py`: views stay thin, rules live here,
and the tests in `scheduling/tests/test_schedule_api.py` exercise the
whole thing over HTTP.
"""

import logging

from django.db import transaction

from audit.services import record_audit_event

from .collisions import find_schedule_collisions
from .schedule import (
    EFFECTIVE_FROM_ERROR,
    earliest_safe_date,
    proposed_timeline,
    provider_today,
    replace_generation,
    validate_weekly_windows,
)

logger = logging.getLogger(__name__)


class ScheduleChangeRejected(Exception):
    """Base for every reason a schedule write is refused; each subclass
    carries the payload the endpoint returns."""


class InvalidScheduleWindows(ScheduleChangeRejected):
    """The weekly windows fail `validate_weekly_windows` (overlap, < 1h
    gap, end before start). `errors` is keyed by day index -> 400."""

    def __init__(self, errors):
        super().__init__("Invalid weekly windows.")
        self.errors = errors


class InvalidEffectiveFrom(ScheduleChangeRejected):
    """`effective_from` is not strictly after the provider-local today
    -> 400 on that field."""

    message = EFFECTIVE_FROM_ERROR


class ScheduleCollidesWithBookings(ScheduleChangeRejected):
    """The proposed timeline would strand at least one active booking
    (project.md edge case 3). Nothing is written. `collisions` lists the
    affected bookings; `earliest_safe_date` is the first date the change
    could take effect without stranding any -> 409."""

    def __init__(self, collisions, earliest_safe_date):
        super().__init__("Schedule change collides with existing bookings.")
        self.collisions = collisions
        self.earliest_safe_date = earliest_safe_date


def apply_schedule_change(provider, windows, effective_from):
    """Validate, collision-check, and write one whole generation of
    `provider`'s weekly hours, then record the audit entry.

    1. `validate_weekly_windows` -> `InvalidScheduleWindows` before any DB
       read.
    2. `effective_from` must be null (apply now) or a provider-local date
       strictly after today -> `InvalidEffectiveFrom`.
    3. Build the post-write timeline and scan the next
       `collisions.DEFAULT_HORIZON_DAYS` for stranded bookings ->
       `ScheduleCollidesWithBookings`, nothing written.
    4. `replace_generation` and the audit row commit together: an audit
       entry never claims a schedule change that didn't land, and a
       change never lands unaudited.
    """
    window_errors = validate_weekly_windows(windows)
    if window_errors:
        raise InvalidScheduleWindows(window_errors)

    today = provider_today(provider)
    if effective_from is not None and effective_from <= today:
        raise InvalidEffectiveFrom()

    timeline = proposed_timeline(provider, windows, effective_from, today=today)
    collisions = find_schedule_collisions(provider, timeline)
    if collisions:
        raise ScheduleCollidesWithBookings(
            collisions,
            earliest_safe_date(
                collisions,
                provider=provider,
                today=today,
                generation_keys=[key for key, _ in timeline],
                target_key=effective_from,
            ),
        )

    with transaction.atomic():
        replace_generation(provider, windows, effective_from, today=today)
        if effective_from is None:
            record_audit_event(
                actor=provider,
                action="update:availability_schedule",
                target_type="availability_schedule",
                target_id=provider.id,
            )
        else:
            record_audit_event(
                actor=provider,
                action="schedule:availability_change",
                target_type="availability_schedule",
                target_id=provider.id,
                metadata={"effective_from": effective_from.isoformat()},
            )
    logger.info(
        "schedule replaced provider_id=%s effective_from=%s", provider.id, effective_from
    )
