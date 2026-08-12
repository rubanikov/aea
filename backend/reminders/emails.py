"""The reminder-email seam -- architecture.md §7 + the reminders ticket's
brief ("a thin `send_reminder_email(booking)` function you can
monkey-patch/mock in tests, rather than the dispatch loop calling
`requests.post` inline"). `reminders.services.dispatch_due_reminders`
calls `send_reminder_email` and nothing else in this module; tests patch
that one function rather than reaching into `urllib`.

The actual Resend HTTP call lives in `bookings.notifications.send_email`
(doctor-cancel-reason-notify ticket 03 extracted it) -- one transport,
shared with the cancellation-notification path, instead of two copies of
the same `urllib` POST. The `request`/`error` aliases below are re-imported
here so existing tests that patch `reminders.emails.request.urlopen`
keep intercepting the shared transport's call (both modules reference
`urllib.request.urlopen` through the module object, never a bound name).

PHI-free by design (architecture.md §7's explicit requirement): the email
subject/body never include the patient's name, the appointment type, or
any other health-context detail -- see `build_reminder_email_body` below.
The body's link points at the frontend's `/patient/appointments` page
(the only appointments route the frontend actually has -- the earlier
`/appointments/{id}` link was a dead route), where the actual appointment
detail lives behind login.
"""

from __future__ import annotations

import logging
from urllib import error, request  # noqa: F401 -- test patch target, see docstring

from django.conf import settings

from bookings.notifications import RESEND_SEND_URL, SendEmailError, send_email  # noqa: F401

logger = logging.getLogger(__name__)

REMINDER_EMAIL_SUBJECT = "You have an upcoming appointment"

# The cron job's send timeout -- background dispatch can afford a longer
# wait than `bookings.notifications`' user-facing 5s.
REMINDER_SEND_TIMEOUT_SECONDS = 10


class SendReminderEmailError(Exception):
    """Resend rejected the send (non-2xx response) or the HTTP call itself
    failed (network error, timeout, DNS, ...). Caught by
    `reminders.services.dispatch_due_reminders`, which does not write a
    `ReminderLog` row for this outcome -- the booking stays "due" and is
    retried on the next cron run.
    """


def build_reminder_email_body(booking) -> str:
    """The literal, PHI-free email body: a generic notice plus a link into
    the frontend's "My Appointments" page (`FRONTEND_BASE_URL`, see
    config/settings.py). Deliberately references nothing booking-derived
    at all -- never `booking.patient.name`,
    `booking.appointment_type.name`, or `booking.start_time` -- so nothing
    about *why* the appointment exists or *who* the patient is ever
    reaches Resend's servers. The actual detail is available to the
    patient only after they authenticate at that link.
    """
    frontend_base_url = settings.FRONTEND_BASE_URL.rstrip("/")
    link = f"{frontend_base_url}/patient/appointments"
    return (
        "You have an upcoming appointment.\n\n"
        f"View the details securely in your account: {link}\n\n"
        "If you weren't expecting this message, you can safely ignore it."
    )


def send_reminder_email(booking) -> bool:
    """Send `booking`'s 24h reminder via Resend's REST API.

    Returns `True` if Resend accepted the send -- the caller may write a
    `ReminderLog` row. Returns `False` if the send was skipped because
    `RESEND_API_KEY` isn't configured (logged at WARNING, with the
    booking id for this job's log trail) -- a deliberate choice for
    local/test/demo environments, which never have a real Resend key: a
    missing key here fails safe (no send, no log row, retried next run)
    rather than raising and aborting every other due reminder in the same
    run. Raises `SendReminderEmailError` if Resend itself rejects the
    request or the HTTP call fails -- a real failure, distinct from "not
    configured," that the caller also must not log as sent.
    """
    if not settings.RESEND_API_KEY:
        logger.warning(
            "reminder email skipped, RESEND_API_KEY not set booking_id=%s", booking.id
        )
        return False

    try:
        return send_email(
            booking.patient.email,
            REMINDER_EMAIL_SUBJECT,
            build_reminder_email_body(booking),
            timeout=REMINDER_SEND_TIMEOUT_SECONDS,
        )
    except SendEmailError as exc:
        raise SendReminderEmailError(f"{exc} for booking_id={booking.id}") from exc
