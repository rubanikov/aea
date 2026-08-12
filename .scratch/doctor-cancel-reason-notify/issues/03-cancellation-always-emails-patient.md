# 03 — Cancellation always emails the patient

**What to build:** The moment a provider's cancellation commits, the patient is emailed a minimal cancellation notice (their local date/time, the reason verbatim, a portal link); the provider sees a non-blocking warning in the UI if the email failed.

**Blocked by:** 01 — needs the committed transition + reason to notify from.

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `bookings/notifications.py` (new), `bookings/views.py` (wire the call + response block), `reminders/emails.py` (extract shared seam, fix dead link), `architecture.md` §7.
**Frontend scope:** `AgendaRow.tsx` (email-failure warning state), `lib/bookings/types.ts` (`CancellationNotification` interface).

## Acceptance criteria
- [ ] `bookings/notifications.py` (new): `send_email(to, subject, text)` seam extracted from `reminders/emails.py` (single Resend transport reused by both reminder job and this path)
- [ ] `notify_cancellation(booking)` called from the status view AFTER `transition()` returns/commits (never before — a rolled-back cancellation must never notify); never raises; always returns a result dict; 5s send timeout
- [ ] Email subject `"Your appointment was cancelled"`, body per brief template, date/time rendered in `booking.patient.timezone` (never provider's zone, never bare UTC) — DST-correctness test included
- [ ] Link is `{FRONTEND_BASE_URL}/patient/appointments`; also fix the existing reminder email's dead link (currently `/appointments/{id}`) to the same route, in the same file touch
- [ ] `email_sent`/`email_failed` in response `notification` block; `not_configured` skip reason when `RESEND_API_KEY` absent
- [ ] `PATCH /bookings/<id>/status` response is 200 even when notification fails; notification outcome never changes status code
- [ ] `AgendaRow.tsx`: on `notification.email_failed`, render `role="status"` (not alert) warning "Appointment cancelled, but we couldn't reach the patient by email."
- [ ] Doc task: amend `architecture.md` §7's PHI-free claim with a scoped exception covering this minimal notification content (statement + patient-local date/time + reason + link only — no patient/provider/appointment-type names)

## Brief anchors
- API: `PATCH /bookings/<id>/status` response `notification` block shape (`email_sent`, `email_failed`, plus SMS fields added by ticket 05)
- UI/wireframe: notification content is deliberately minimal — no patient name, provider name, or appointment type
- Note: reason stays out of the audit log (already enforced in 01); this ticket doesn't touch that
