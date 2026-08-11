"""architecture.md §7's reminder dispatch loop -- the one write path to
`ReminderLog`. Called by the `dispatch_reminders` management command (the
actual Railway cron entry point, see that command's docstring) and
directly by tests; there is no other write path, mirroring
`bookings.services.create_booking`'s "one function, single write path"
shape for `Booking`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from bookings.models import Booking

from .emails import SendReminderEmailError, send_reminder_email
from .models import ReminderLog

logger = logging.getLogger(__name__)

REMINDER_INTERVAL_24H = ReminderLog.INTERVAL_24H

# Window choice: a booking is "due" for the 24h reminder when its
# `start_time` falls between `now + 23h` and `now + 25h` -- a 2-hour
# window straddling the 24h mark, not an exact instant. Sized against the
# cron cadence documented in reminders/README.md (every 15-30 min): a
# 2-hour window means any given due booking is still inside the window
# across at least 4 consecutive cron runs (2h / 30min-worst-case cadence)
# before it ages out the far side, so one missed, slow, or crashed run is
# never enough to skip a reminder outright. Not wider than that on
# purpose -- `.exclude(reminder_logs__interval=...)` below already makes
# every run after the first a cheap no-op for a given booking, so a wider
# window's only cost would be reconsidering (and re-excluding) the same
# already-sent bookings for longer, with no correctness benefit.
WINDOW_START_OFFSET = timedelta(hours=23)
WINDOW_END_OFFSET = timedelta(hours=25)


@dataclass(frozen=True)
class DispatchSummary:
    """What `dispatch_due_reminders` returns -- the management command
    prints this, and tests assert against it directly instead of
    re-deriving counts from `ReminderLog`/log output.
    """

    considered: int
    sent: int
    skipped: int
    failed: int
    already_logged: int


def dispatch_due_reminders(*, now=None) -> DispatchSummary:
    """Send the 24h reminder for every confirmed booking due in the window
    (see `WINDOW_START_OFFSET`/`WINDOW_END_OFFSET`), exactly once per
    booking -- safe to call repeatedly, concurrently, or after a
    crash/restart mid-run (this ticket's accept criteria).

    `now` defaults to real "now" (`django.utils.timezone.now()`); tests
    pass an explicit value instead of freezing the clock.

    Candidate query: `status=CONFIRMED`, `start_time` in the window,
    left-excluding any booking that already has a `ReminderLog` row for
    `REMINDER_INTERVAL_24H` (architecture.md §7 -- this exclude is an
    optimization to avoid redundant sends in the common case, *not* the
    correctness guarantee; that's `ReminderLog.Meta`'s `UniqueConstraint`).

    For each remaining booking:

    1. Log the attempt (this ticket's brief: every attempt is visible in
       logs even if it ultimately fails).
    2. Call `send_reminder_email(booking)`. A `SendReminderEmailError`
       (Resend rejected the send, or the HTTP call failed) is caught and
       logged; a `False` return (no `RESEND_API_KEY` configured) is
       treated the same way -- either way, no `ReminderLog` row gets
       written, so this booking is still "due" and is retried on the next
       run.
    3. On a genuine send, insert the `ReminderLog` row inside its own
       `transaction.atomic()` savepoint, catching the `IntegrityError` the
       unique constraint raises if a concurrent/retried run already
       logged this exact booking+interval first -- the same "insert,
       catch the constraint violation, treat as success" shape
       `bookings.services.create_booking`'s Layer 2 backstop uses. The
       savepoint keeps that `IntegrityError` from poisoning the rest of
       this loop's transaction state.
    """
    now = now or timezone.now()
    window_start = now + WINDOW_START_OFFSET
    window_end = now + WINDOW_END_OFFSET

    due_bookings = Booking.objects.filter(
        status=Booking.Status.CONFIRMED,
        start_time__gte=window_start,
        start_time__lt=window_end,
    ).exclude(reminder_logs__interval=REMINDER_INTERVAL_24H)

    considered = sent = skipped = failed = already_logged = 0

    for booking in due_bookings:
        considered += 1
        logger.info(
            "reminder dispatch attempt booking_id=%s interval=%s",
            booking.id,
            REMINDER_INTERVAL_24H,
        )

        try:
            was_sent = send_reminder_email(booking)
        except SendReminderEmailError:
            failed += 1
            logger.exception(
                "reminder send failed booking_id=%s interval=%s",
                booking.id,
                REMINDER_INTERVAL_24H,
            )
            continue

        if not was_sent:
            # send_reminder_email already logged the reason (no API key).
            skipped += 1
            continue

        try:
            with transaction.atomic():
                ReminderLog.objects.create(booking=booking, interval=REMINDER_INTERVAL_24H)
        except IntegrityError:
            already_logged += 1
            logger.info(
                "reminder already logged by a concurrent/retried run "
                "booking_id=%s interval=%s",
                booking.id,
                REMINDER_INTERVAL_24H,
            )
            continue

        sent += 1
        logger.info(
            "reminder sent booking_id=%s interval=%s", booking.id, REMINDER_INTERVAL_24H
        )

    return DispatchSummary(
        considered=considered,
        sent=sent,
        skipped=skipped,
        failed=failed,
        already_logged=already_logged,
    )
