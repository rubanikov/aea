"""The actual Railway cron entry point (architecture.md §7, this ticket's
brief). Deliberately thin -- `reminders.services.dispatch_due_reminders`
holds all the selection/dedup/send/log logic; this command's only job is
to invoke it and print a one-line summary Railway's log capture will show.

Railway wiring is config-as-code in `backend/railway.cron.json` (a second
service in the same project as the web service, `*/15 * * * *`, start
command `python manage.py dispatch_reminders`) -- see `reminders/README.md`
for the provisioning commands and the variable references it needs.
Every 15 minutes is the lower end of the 15-30 min range the 2h due
window in `reminders.services` was sized for, so each due booking gets
at least 4-8 chances before it ages out.

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
