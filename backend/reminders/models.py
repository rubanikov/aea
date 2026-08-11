from django.db import models

from bookings.models import Booking


class ReminderLog(models.Model):
    """Append-only "a reminder was successfully sent" record --
    architecture.md §7. This is the actual dedup guarantee (the
    `UniqueConstraint` below), not the query filter
    `reminders.services.dispatch_due_reminders` uses to skip already-sent
    bookings -- that filter is an optimization to avoid redundant sends in
    the common case, same "constraint is the backstop" relationship as
    `Booking.Meta`'s partial `UniqueConstraint` (architecture.md §3).

    Only a genuinely successful send creates a row here (see
    `reminders.services.dispatch_due_reminders`) -- a failed or skipped
    attempt does not, on purpose: the constraint means "sent exactly
    once," not "attempted exactly once," so a booking with no row here is
    still "due" and gets retried on the next cron run.

    One interval supported this pass -- `INTERVAL_24H`, architecture.md
    §7's own stated example. `interval` is still a field (not hardcoded
    into the model/constraint) so a second interval is a data addition
    later, not a schema migration mid-flight, but nothing beyond that is
    built out now (this ticket's brief: don't over-build a multi-interval
    system for one interval's worth of requirements).
    """

    INTERVAL_24H = "24h"
    INTERVAL_CHOICES = [(INTERVAL_24H, "24 hours before")]

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="reminder_logs")
    interval = models.CharField(max_length=20, choices=INTERVAL_CHOICES, default=INTERVAL_24H)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-sent_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["booking", "interval"], name="unique_reminder_per_booking_interval"
            )
        ]

    def __str__(self):
        return f"reminder({self.interval}) booking={self.booking_id} sent_at={self.sent_at}"
