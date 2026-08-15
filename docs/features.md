# Feature guide

What each role can do in the portal, and the rules the app enforces while
they do it. Written for someone clicking through the demo (accounts and
password in [`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md)); the API view of
the same behaviour is [`api.md`](api.md), and the reasoning behind the rules
is [`architecture.md`](../architecture.md).

All times are stored in UTC and shown in the logged-in account's timezone
(every demo account is `America/Chicago`; change yours under Settings). Every
screen works in light and dark theme (toggle in the header) and with the
keyboard.

## Everyone

- **Register / log in** at `/login`. Registration always creates a
  *patient*; providers and admins are provisioned by the operator. Inline
  field validation, password show/hide, and a clear message when a session
  has expired (`/login?session_expired=1`).
- **Role-gated navigation.** Visiting another role's area redirects to
  `/access-denied`; visiting anything while logged out redirects to
  `/login`. The gate runs on the server before the page renders (`proxy.ts`).
- **Settings** (`/settings`, reachable from every portal's nav):
  - Profile: name, email, phone, **SMS carrier** (US carriers; with a phone
    number this opts you into SMS cancellation notices), timezone (IANA
    list).
  - Password change (current password required; other sessions are logged
    out).
  - **Delete account** ("Danger zone"): re-enter your password; upcoming
    appointments are cancelled, identifying fields are scrubbed in place,
    you are logged out, and the screen tells you how many appointments were
    freed. Audit history is kept, de-identified. Details:
    [`backend/docs/retention-policy.md`](../backend/docs/retention-policy.md).
- **Session security you'll notice:** 15-minute access tokens refreshed
  silently; 5 login attempts/min per IP; an account locks for 15 minutes
  after 10 failed logins.

## Patient

Nav: **Dashboard** (`/patient`) · **My Appointments** (`/patient/appointments`) · Settings.

- **Dashboard** — your own week-grid calendar with a "+ Book appointment"
  button; the mini-month jumps weeks/months.
- **Book** (`/patient/book`) — a four-step wizard with a persistent summary
  rail: **Provider → Service (appointment type, 30 or 60 min) → Date & time →
  Confirm**. Slots are computed live from the provider's hours, blocked
  time, their existing bookings *and yours* (you can't hold two overlapping
  appointments even with different providers), and never in the past. A
  provider with no hours configured is shown as not bookable rather than
  empty. Booking confirms immediately — there is no "pending approval"
  state. If someone takes the slot in the split second before you confirm,
  you see a clear "slot no longer available" message and can pick another;
  double-clicking the confirm button cannot create two bookings.
- **My Appointments** — **Upcoming / Past / Cancelled** tabs. Each card
  shows provider, service, time (your timezone), status badge, a
  "✉ Reminder sent" note once the 24-hour reminder went out, and — for a
  provider-cancelled appointment — the provider's written reason.
  - **Cancel** — allowed until **24 hours** before the start; inside that
    window the button is disabled with the reason spelled out.
  - **Reschedule** — opens a slot picker for the same provider and service;
    the move is atomic (your old slot is only released if the new one is
    secured). Same 24-hour rule, measured against the *original* time.
- **Notifications you receive** (when the deployment has an email key
  configured; the demo deployment logs instead of sending):
  - a reminder email ~24 h before each confirmed appointment (PHI-free: time
    + link to the portal);
  - if a provider cancels: an email and, if you saved a phone + carrier, an
    SMS, both carrying the appointment time and the provider's reason.

## Provider

Nav: **Dashboard** (`/provider/calendar`) · **Availability** (`/provider`) · Settings.

- **Dashboard / calendar** — week grid + day agenda of your bookings with
  the patient's name and service. Per appointment: **Mark completed**,
  **Mark no-show** (only after the start time has passed), **Cancel** — which
  requires a written **reason** (≤500 characters) and, like patients,
  respects the 24-hour notice rule. Cancelling triggers the patient's
  email/SMS notice; if either could not be delivered you get a "please call
  the patient" warning next to the appointment (a patient with no phone or
  carrier on file is simply not texted — no warning). Only you (and an
  admin) can see or act on your calendar.
- **Availability settings** — three sections, all required before you're
  really bookable:
  1. **Appointment types** — name + slot length **30 or 60 min**. Changing a
     type's length while it has future bookings is refused with the list of
     affected appointments.
  2. **Weekly hours** — several blocks per weekday (e.g. 08:00–12:00 and
     13:00–17:00; blocks need at least a 1-hour gap). Save **now**, or pick a
     future **effective from** date to create a *pending schedule* that
     takes over on that date — a banner shows it and lets you discard it. If
     the new hours collide with existing bookings (checked up to 133 days
     out) you get a collision dialog listing them, with the earliest date the
     change *could* start cleanly; nothing is saved until you choose.
  3. **Blocked time** — one-off unavailability (vacation, admin block) with
     an optional label. If it overlaps bookings you choose in the dialog:
     **keep the new hours** (bookings stay, are flagged as exceptions in the
     audit log for you to handle) or **cancel the change**. Existing
     bookings are never silently deleted by any availability edit.

## Admin

Nav: **Dashboard** (`/admin`) · Settings.

- **Audit log viewer** — every booking creation, status change,
  reschedule, schedule change, blocked-time edit, account deletion request,
  provider calendar read, and every admin action, with filters (actor,
  action text, target type, date range) and pagination (25/page). Entries
  hold IDs, roles and statuses only — no names, contact details or free
  text — and can never be edited or deleted. Your own reads of the log are
  logged too.
- Admins may also read any provider's calendar and act on any booking via
  the API (`GET /bookings?provider_id=`, `PATCH /bookings/<id>/status`);
  every such bypass of the normal ownership rule is written to the audit log
  as `admin_bypass:…`.

## Rules at a glance

| Rule | Value | Enforced in |
|---|---|---|
| Appointment lengths | 30 or 60 min per appointment type | DB check constraint |
| Double booking | impossible for a provider *or* a patient, even with mixed lengths | row lock + unique + exclusion constraints |
| Booking status flow | requested → confirmed → completed / no_show / cancelled | `transition()` |
| Cancellation notice | ≥ 24 h before start, whoever cancels (except account deletion) | `transition()` |
| No-show | only after the start time | `transition()` |
| Provider cancel | requires a reason, notifies patient (email + optional SMS), max 5 notices/recipient/hour | status endpoint + notifications |
| Slot lookup window | ≤ 60 days per query | `GET /scheduling/slots` |
| Availability collision scan | 133 days ahead | `scheduling/collisions.py` |
| Hour blocks | ≥ 1 h gap between blocks on a day; one pending future schedule at a time | `scheduling/schedule.py` |
| Reminders | email ~24 h before (23–25 h window), once per booking, cron every 15 min | `reminders/` |
| Login | 5/min per IP; lockout after 10 failures for 15 min | throttle + lockout |
| Account deletion | password re-entry; scrub in place; cancels upcoming; audited | `accounts/services.py` |

## Not built (by design)

Waitlists, telehealth links, recurring appointments, insurance/intake
capture, natural-language booking — the brief's stretch items — are out of
scope; see `tickets/README.md`. Supabase row-level security was planned as
a second authorization layer and deliberately not adopted (see
`architecture.md` §6).
