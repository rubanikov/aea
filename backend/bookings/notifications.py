"""Patient-facing cancellation notifications (doctor-cancel-reason-notify
tickets 03 + 05) -- and the one low-level seam that actually talks to
Resend, `send_email`, extracted from `reminders.emails` so the existing
reminder job and this new synchronous path share a single transport
instead of two copies of the same `urllib` POST. Ticket 05 adds an SMS
attempt via carrier email-to-SMS gateways -- deliberately *not* a real
SMS API: the gateway address is just another email recipient, so the SMS
rides the exact same `send_email` seam.

Minimal content, but *not* the PHI-free posture `reminders.emails` has:
this is architecture.md §7a's one approved exception. The cancellation
email never includes the patient's name, the provider's name, or the
appointment type -- only the appointment's date/time (in the *patient's*
own timezone), the provider's written reason, and a link into the
authenticated portal where the full detail lives behind login. That
reason is clinician-written text about a specific patient's appointment,
sent over transports with no BAA behind them (Resend, and for the SMS
half the patient's carrier), and the product decision to send it anyway
-- because a patient who isn't told *why* is a patient the feature
failed -- is written up in §7a. Everything except the reason and the
time was left out on purpose.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import timedelta
from urllib import error, request
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from .models import CancellationNotificationLog

logger = logging.getLogger(__name__)

RESEND_SEND_URL = "https://api.resend.com/emails"

CANCELLATION_EMAIL_SUBJECT = "Your appointment was cancelled"

# This send happens inline in a user-facing PATCH request (see
# `bookings.views.BookingStatusView`), not a background cron run like the
# reminder job's 10s -- a hung Resend call should give up well before the
# provider's own request feels broken.
CANCELLATION_SEND_TIMEOUT_SECONDS = 5

# Carrier value (`accounts.models.User.Carrier`) -> email-to-SMS gateway
# domain. Keys mirror the `TextChoices` values exactly; the gateway
# address is `{digits-only phone}@{domain}`.
SMS_GATEWAYS = {
    "verizon": "vtext.com",
    "att": "txt.att.net",
    "tmobile": "tmomail.net",
    "sprint": "messaging.sprintpcs.com",
    "uscellular": "email.uscc.net",
    "boost": "sms.myboostmobile.com",
    "cricket": "sms.cricketwireless.net",
    "metropcs": "mymetropcs.com",
    "googlefi": "msg.fi.google.com",
}

# One GSM-7 segment. The whole message -- when, reason, link -- must fit
# inside it; `build_sms_text` truncates the *reason* (never the link) to
# make that true.
SMS_MAX_CHARS = 160

# Below this many characters of room for the reason, a truncated fragment
# would be meaningless ("Called awa...") -- drop the reason clause
# entirely instead.
_SMS_MIN_REASON_BUDGET = 20

# Per-recipient anti-abuse budget: at most this many cancellation
# notifications may go out to one patient inside
# `RECIPIENT_BUDGET_WINDOW`, counted across email *and* SMS together (one
# `notify_cancellation` call spends exactly one unit).
#
# The endpoint's own throttle (`bookings.views.CancellationRateThrottle`)
# limits how fast one *account* can cancel; this limits how much mail one
# *recipient* can be made to receive, which is the axis that actually
# matters for a cancel/rebook relay loop -- the attacker can change
# booking ids, but not who the notification lands on.
#
# Five an hour is far beyond any real clinic day: a patient would have to
# have five separate appointments cancelled by their provider inside sixty
# minutes to reach it.
RECIPIENT_HOURLY_NOTIFICATION_BUDGET = 5
RECIPIENT_BUDGET_WINDOW = timedelta(hours=1)

# The result dict for a send suppressed by the budget above. Deliberately
# *not* `email_failed` -- nothing failed, we chose not to send -- so it
# reads as the same kind of "skip" an unconfigured `RESEND_API_KEY` is.
# `rate_limited` is the key that distinguishes the two.
RATE_LIMITED_RESULT = {
    "email_sent": False,
    "email_failed": False,
    "sms_attempted": False,
    "sms_sent": False,
    "sms_skipped_reason": "rate_limited",
    "rate_limited": True,
}


class SendEmailError(Exception):
    """Resend rejected the send (non-2xx response) or the HTTP call itself
    failed (network error, timeout, DNS, ...). A *real* failure, distinct
    from the not-configured `False` return below -- callers decide whether
    to retry (`reminders.services`) or swallow and report
    (`notify_cancellation`).
    """


def send_email(to: str, subject: str, text: str, *, timeout: float = 10) -> bool:
    """POST one plain-text email to Resend's REST API.

    Returns `True` if Resend accepted the send. Returns `False` -- logged
    at WARNING, never raised -- when `RESEND_API_KEY` isn't configured: a
    deliberate, supported state for local/test/demo environments (see
    config/settings.py), where "no key" means "skip," not "fail." Raises
    `SendEmailError` for a genuine failure (Resend rejected the request or
    the HTTP call itself died).

    Kept as module-level `request.urlopen` (not a bound import) on
    purpose: `reminders`' existing tests patch `urllib.request.urlopen`
    through the `reminders.emails.request` alias and must keep
    intercepting this call after the extraction.
    """
    api_key = settings.RESEND_API_KEY
    if not api_key:
        # Deliberately no `to=` here -- an email address is a contact
        # detail, and logs carry opaque identifiers only (architecture.md
        # §6's "no PHI in logs"; callers log their own booking id).
        logger.warning("email skipped, RESEND_API_KEY not set")
        return False

    payload = json.dumps(
        {
            "from": settings.RESEND_FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "text": text,
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
        with request.urlopen(req, timeout=timeout) as response:
            if response.status >= 300:
                raise SendEmailError(f"Resend returned status {response.status}")
    except error.HTTPError as exc:
        raise SendEmailError(f"Resend HTTP error {exc.code}") from exc
    except error.URLError as exc:
        raise SendEmailError(f"Resend request failed: {exc.reason}") from exc

    return True


def _portal_link() -> str:
    """The one place the patient-portal appointments URL is built -- the
    email body and the SMS text must always carry the *same* link."""
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/patient/appointments"


def _outbound_reason(reason: str) -> str:
    """`reason` collapsed onto a single line, for outbound message bodies
    only.

    The reason is free text a provider types, and `trim_whitespace` on the
    serializer only strips the *ends* -- interior newlines survive into
    storage. In an email body that is a spoofing surface: a reason ending
    in a blank line and "View your appointments: https://evil.tld" renders
    a line indistinguishable from the genuine link line the builder adds
    below it. Flattening every run of whitespace to one space means a
    multi-line reason can only ever be one line of the message, so the
    system's own lines stay recognisably the system's.

    Only the *rendering* is flattened. `Booking.cancellation_reason` keeps
    the provider's real line breaks, and the patient sees them intact in
    the app (`AppointmentCard` renders it `pre-wrap`) -- there the text is
    already visibly inside a "reason" box, with no system lines nearby to
    impersonate.
    """
    return " ".join(reason.split())


def _patient_local_start(booking):
    """`booking.start_time` (a UTC instant) as a wall-clock datetime in
    the patient's own zone -- shared by the email and SMS builders so the
    two can never disagree about what time the appointment was."""
    zone_name = booking.patient.timezone or "UTC"
    return zone_name, booking.start_time.astimezone(ZoneInfo(zone_name))


def build_cancellation_email_body(booking) -> tuple[str, str]:
    """Return `(subject, body)` for `booking`'s cancellation email.

    The date/time is rendered in the *patient's* own timezone
    (`booking.patient.timezone`, an IANA name defaulting to "UTC") --
    never the provider's, never bare UTC: the stored `start_time` is a
    UTC instant (architecture.md §5) and the patient reads their own wall
    clock. `zoneinfo` does the conversion, so DST is handled by the tz
    database, not by hand. The zone name is printed alongside so the
    rendered time is unambiguous even if the patient's stored zone is
    stale.

    The reason is `booking.cancellation_reason` in full -- no truncation;
    the 500-char cap was already enforced at write time by
    `BookingStatusUpdateSerializer`. Its interior line breaks are the one
    thing that doesn't survive: see `_outbound_reason` for why a
    provider-written reason must not be able to occupy more than one line
    of this body.
    """
    zone_name, local_start = _patient_local_start(booking)
    # Not one strftime call: `%-I`/`%#I` (unpadded hour) is platform-
    # specific, so the hour is formatted portably by hand instead.
    hour = int(local_start.strftime("%I"))
    when = (
        f"{local_start.strftime('%A, %B')} {local_start.day}, {local_start.year} "
        f"at {hour}:{local_start.strftime('%M %p')} ({zone_name})"
    )

    link = _portal_link()

    body = (
        f"Your appointment on {when} has been cancelled.\n\n"
        f"Reason: {_outbound_reason(booking.cancellation_reason)}\n\n"
        f"View your appointments: {link}"
    )
    return CANCELLATION_EMAIL_SUBJECT, body


def build_sms_text(booking) -> str:
    """One <=160-char GSM-7 message: `"Your appointment on {when} was
    cancelled. Reason: {reason} {link}"`.

    `{when}` is compact patient-local time ("Aug 18 at 10:00 AM" -- no
    weekday/year/zone name; the character budget is tight), converted via
    the same zone logic as `build_cancellation_email_body`. The link is
    the same portal link the email carries and is *never* truncated; the
    reason is what gives way:

    - the reason is ASCII-folded first (NFKD, drop non-ASCII) so smart
      quotes/accents/emoji can't silently blow the GSM-7 budget -- the
      *email* keeps the reason's characters as written, only the SMS folds
      them -- and then flattened onto one line like the email's
      (`_outbound_reason`), which also stops a newline in the reason from
      splitting the text into two apparent messages;
    - if it fits the remaining budget, it goes verbatim;
    - if not and >=20 chars remain, it's cut to `budget - 3`, rstripped,
      and suffixed with literal `"..."` (never `…`, which is outside
      GSM-7 and would force the whole message into UCS-2);
    - if fewer than 20 chars remain (pathologically long link/when), the
      whole "Reason: ..." clause is dropped rather than sending a
      meaningless fragment.
    """
    zone_name, local_start = _patient_local_start(booking)
    hour = int(local_start.strftime("%I"))  # unpadded hour, portably (see email builder)
    when = (
        f"{local_start.strftime('%b')} {local_start.day} "
        f"at {hour}:{local_start.strftime('%M %p')}"
    )
    link = _portal_link()

    reason = _outbound_reason(
        unicodedata.normalize("NFKD", booking.cancellation_reason)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    overhead = (
        len("Your appointment on ")
        + len(when)
        + len(" was cancelled. Reason: ")
        + len(" ")
        + len(link)
    )
    budget = SMS_MAX_CHARS - overhead
    if len(reason) > budget:
        if budget >= _SMS_MIN_REASON_BUDGET:
            reason = reason[: budget - 3].rstrip() + "..."
        else:
            return f"Your appointment on {when} was cancelled. {link}"
    return f"Your appointment on {when} was cancelled. Reason: {reason} {link}"


def _attempt_cancellation_email(booking) -> dict:
    """The email half of `notify_cancellation`'s result dict. Never raises.

    Building the body is inside the same `try` as the send on purpose:
    `build_cancellation_email_body` reads `patient.timezone` through
    `ZoneInfo`, and that field has no model-level validator (only
    `/profile`'s serializer checks it -- the admin and the seed scripts
    write it directly), so an invalid IANA name raises
    `ZoneInfoNotFoundError` here. That is a notification problem, not a
    cancellation problem: the booking is already cancelled by the time
    this runs, and letting the error out would turn a succeeded cancel
    into a 500. It reports as `email_failed`, the same as a dead Resend --
    from the provider's side both mean "the patient wasn't told."
    """
    try:
        subject, body = build_cancellation_email_body(booking)
        sent = send_email(
            booking.patient.email, subject, body, timeout=CANCELLATION_SEND_TIMEOUT_SECONDS
        )
    except Exception:
        logger.exception("cancellation email failed booking_id=%s", booking.id)
        return {"email_sent": False, "email_failed": True}

    if not sent:
        logger.warning(
            "cancellation email skipped, RESEND_API_KEY not set booking_id=%s", booking.id
        )
        return {"email_sent": False, "email_failed": False}

    logger.info("cancellation email sent booking_id=%s", booking.id)
    return {"email_sent": True, "email_failed": False}


def _attempt_cancellation_sms(booking) -> dict:
    """The SMS half of `notify_cancellation`'s result dict. Never raises.

    Attempted iff the patient has both a phone and a carrier we have a
    gateway for; the recipient is `{digits-only phone}@{gateway}`.
    `sms_skipped_reason` is `"no_phone"` / `"no_carrier"` /
    `"unknown_carrier"` (defensive -- `Carrier` choices should make it
    impossible) / `"send_failed"`, or `None` on success. An unconfigured
    `RESEND_API_KEY` (send_email's `False` return) reports as
    `"send_failed"` too: unlike email there is no third "skipped" state
    in this contract, and either way the patient got no text.
    """
    phone = booking.patient.phone
    carrier = booking.patient.sms_carrier
    if not phone:
        return {"sms_attempted": False, "sms_sent": False, "sms_skipped_reason": "no_phone"}
    if not carrier:
        return {"sms_attempted": False, "sms_sent": False, "sms_skipped_reason": "no_carrier"}
    gateway = SMS_GATEWAYS.get(carrier)
    if gateway is None:
        return {"sms_attempted": False, "sms_sent": False, "sms_skipped_reason": "unknown_carrier"}

    try:
        digits = re.sub(r"\D", "", phone)
        sent = send_email(
            f"{digits}@{gateway}",
            CANCELLATION_EMAIL_SUBJECT,
            build_sms_text(booking),
            timeout=CANCELLATION_SEND_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.exception("cancellation sms failed booking_id=%s", booking.id)
        return {"sms_attempted": True, "sms_sent": False, "sms_skipped_reason": "send_failed"}

    if not sent:
        logger.warning(
            "cancellation sms skipped, RESEND_API_KEY not set booking_id=%s", booking.id
        )
        return {"sms_attempted": True, "sms_sent": False, "sms_skipped_reason": "send_failed"}

    logger.info("cancellation sms sent booking_id=%s", booking.id)
    return {"sms_attempted": True, "sms_sent": True, "sms_skipped_reason": None}


def _claim_recipient_budget(patient) -> bool:
    """Spend one unit of `patient`'s hourly notification budget.

    `True` -- there was room, a `CancellationNotificationLog` row records
    the spend. `False` -- the budget is used up and nothing should be sent
    to this patient right now.

    Unlike `reminders.models.ReminderLog`, which records only *successful*
    sends because it exists to guarantee "sent exactly once," a row here
    records an *attempt*: this log exists to cap how much traffic one
    recipient can be made to receive, and a send that failed at the
    transport still consumed an attempt's worth of it.
    """
    since = timezone.now() - RECIPIENT_BUDGET_WINDOW
    recent = CancellationNotificationLog.objects.filter(
        patient=patient, created_at__gte=since
    ).count()
    if recent >= RECIPIENT_HOURLY_NOTIFICATION_BUDGET:
        return False
    CancellationNotificationLog.objects.create(patient=patient)
    return True


def notify_cancellation(booking) -> dict:
    """Email `booking.patient` that their appointment was cancelled.

    (ticket 03), and text them too when their phone + carrier are known
    (ticket 05).

    Never raises -- the caller (`bookings.views.BookingStatusView`) has
    already committed the cancellation, and a notification hiccup must
    not turn a succeeded cancel into a 500. Returns one flat dict:

    - `email_sent` / `email_failed` -- exactly ticket 03's contract:
      sent+not-failed when Resend accepted it, not-sent+failed on a real
      failure (a dead Resend, an unrenderable body, anything else
      unexpected -- all logged in `_attempt_cancellation_email`), neither
      when skipped because `RESEND_API_KEY` isn't configured (the reminder
      job's "unconfigured is a skip" convention);
    - `sms_attempted` / `sms_sent` / `sms_skipped_reason` -- see
      `_attempt_cancellation_sms`. The two halves are independent: a
      failed or skipped SMS never touches the email keys, and vice
      versa;
    - `rate_limited` -- true only when this patient's hourly budget
      (`RECIPIENT_HOURLY_NOTIFICATION_BUDGET`) was already spent, in which
      case *neither* channel was tried and the other five keys carry
      `RATE_LIMITED_RESULT`'s values. The cancellation itself still stands:
      this suppresses the notification, never the cancel.

    A rate-limited skip deliberately reports `email_sent: False` with
    `email_failed: False`, which the provider UI reads as "the patient
    wasn't told" (its warning triggers on not-*sent*, not on failure). We
    kept that warning rather than suppressing it: when a real provider
    trips this, the patient genuinely did not get the notice, and "call
    them" is exactly the right advice. `rate_limited` is there so a caller
    that wants to word it differently can tell this apart from a delivery
    failure.
    """
    if not _claim_recipient_budget(booking.patient):
        logger.warning(
            "cancellation notification rate limited booking_id=%s patient_id=%s",
            booking.id,
            booking.patient_id,
        )
        return dict(RATE_LIMITED_RESULT)

    return {
        **_attempt_cancellation_email(booking),
        **_attempt_cancellation_sms(booking),
        "rate_limited": False,
    }
