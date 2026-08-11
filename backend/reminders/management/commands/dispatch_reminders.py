"""The actual Railway cron entry point (architecture.md §7, this ticket's
brief). Deliberately thin -- `reminders.services.dispatch_due_reminders`
holds all the selection/dedup/send/log logic; this command's only job is
to invoke it and print a one-line summary Railway's log capture will show.

Railway cron configuration (this ticket's point 5 -- documented here since
this environment has no live Railway account to wire the actual schedule
against): add a second service in the same Railway project as the
existing web service (see backend/railway.json), pointed at this same
repo/build, but with:

    - Deploy > Cron Schedule: `*/15 * * * *` (every 15 minutes -- the
      lower end of the ticket's 15-30 min range, so the redundancy
      documented in `reminders.services`'s `WINDOW_START_OFFSET`/
      `WINDOW_END_OFFSET` comment -- at least 4 chances per due booking --
      comes from a 2h window over a 30-min *worst case* cadence; running
      every 15 min doubles that margin for free).
    - Deploy > Start Command: `python manage.py dispatch_reminders`
    - Same environment variables as the web service (`DATABASE_URL`,
      `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FRONTEND_BASE_URL`) --
      Railway lets a cron service share a project's variable set, or they
      can be duplicated onto the cron service directly.
    - No public networking/domain needed -- this service never receives
      inbound HTTP traffic, it only runs on a schedule and talks out to
      Postgres and Resend.

Railway's cron services run to completion each trigger and do not
overlap a still-running previous invocation by default, but this command
(via `dispatch_due_reminders`) is safe even if that guarantee is ever
violated, or if a run is retried/restarted mid-way -- see that function's
docstring for the concurrency guarantee.
"""

from django.core.management.base import BaseCommand

from reminders.services import dispatch_due_reminders


class Command(BaseCommand):
    help = (
        "Send the 24h reminder email for every confirmed booking due in the "
        "window, skipping any already logged as sent. Safe to run repeatedly, "
        "concurrently, or after a crash mid-run -- see reminders/README.md."
    )

    def handle(self, *args, **options):
        summary = dispatch_due_reminders()
        self.stdout.write(
            self.style.SUCCESS(
                f"reminders dispatched: considered={summary.considered} "
                f"sent={summary.sent} skipped={summary.skipped} "
                f"failed={summary.failed} already_logged={summary.already_logged}"
            )
        )
