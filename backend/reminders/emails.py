"""The one seam that talks to Resend -- architecture.md §7 + this ticket's
brief ("a thin `send_reminder_email(booking)` function you can
monkey-patch/mock in tests, rather than the dispatch loop calling
`requests.post` inline"). `reminders.services.dispatch_due_reminders` calls
`send_reminder_email` and nothing else in this module; tests patch that one
function rather than reaching into `urllib`.

No `requests` dependency added -- it isn't already in `requirements.txt`,
and a single POST to Resend's REST API is simple enough that stdlib
`urllib.request` covers it without a new third-party dependency.

PHI-free by design (architecture.md §7's explicit requirement): the email
subject/body never include the patient's name, the appointment type, or
any other health-context detail -- see `build_reminder_email_body` below,
whose only booking-derived input is `booking.id` (an opaque identifier,
not PHI) embedded in a link into the authenticated frontend portal, where
the actual appointment detail lives behind login.
"""

from __future__ import annotations

import json
import logging
from urllib import error, request

from django.conf import settings

logger = logging.getLogger(__name__)

RESEND_SEND_URL = "https://api.resend.com/emails"

REMINDER_EMAIL_SUBJECT = "You have an upcoming appointment"


class SendReminderEmailError(Exception):
    """Resend rejected the send (non-2xx response) or the HTTP call itself
    failed (network error, timeout, DNS, ...). Caught by
    `reminders.services.dispatch_due_reminders`, which does not write a
    `ReminderLog` row for this outcome -- the booking stays "due" and is
    retried on the next cron run.
    """


def build_reminder_email_body(booking) -> str:
    """The literal, PHI-free email body: a generic notice plus a link into
    the frontend's appointment view (`FRONTEND_BASE_URL`, see
    config/settings.py). Deliberately references only `booking.id` --
    never `booking.patient.name`, `booking.appointment_type.name`, or
    `booking.start_time` -- so nothing about *why* the appointment exists
    or *who* the patient is ever reaches Resend's servers. The actual
    detail is available to the patient only after they authenticate at
    that link.
    """
    frontend_base_url = settings.FRONTEND_BASE_URL.rstrip("/")
    link = f"{frontend_base_url}/appointments/{booking.id}"
    return (
        "You have an upcoming appointment.\n\n"
        f"View the details securely in your account: {link}\n\n"
        "If you weren't expecting this message, you can safely ignore it."
    )


def send_reminder_email(booking) -> bool:
    """Send `booking`'s 24h reminder via Resend's REST API.

    Returns `True` if Resend accepted the send -- the caller may write a
    `ReminderLog` row. Returns `False` if the send was skipped because
    `RESEND_API_KEY` isn't configured (logged at WARNING so it's visible
    without crashing the whole dispatch run) -- a deliberate choice for
    local/test/demo environments, which never have a real Resend key: a
    missing key here fails safe (no send, no log row, retried next run)
    rather than raising and aborting every other due reminder in the same
    run. Raises `SendReminderEmailError` if Resend itself rejects the
    request or the HTTP call fails -- a real failure, distinct from "not
    configured," that the caller also must not log as sent.
    """
    api_key = settings.RESEND_API_KEY
    if not api_key:
        logger.warning(
            "reminder email skipped, RESEND_API_KEY not set booking_id=%s", booking.id
        )
        return False

    payload = json.dumps(
        {
            "from": settings.RESEND_FROM_EMAIL,
            "to": [booking.patient.email],
            "subject": REMINDER_EMAIL_SUBJECT,
            "text": build_reminder_email_body(booking),
        }
    ).encode("utf-8")

    req = request.Request(
        RESEND_SEND_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=10) as response:
            if response.status >= 300:
                raise SendReminderEmailError(
                    f"Resend returned status {response.status} for booking_id={booking.id}"
                )
    except error.HTTPError as exc:
        raise SendReminderEmailError(
            f"Resend HTTP error {exc.code} for booking_id={booking.id}"
        ) from exc
    except error.URLError as exc:
        raise SendReminderEmailError(
            f"Resend request failed for booking_id={booking.id}: {exc.reason}"
        ) from exc

    return True
