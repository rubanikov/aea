# 01 — Provider cancel requires a written reason

**What to build:** A doctor cancelling a booking via `PATCH /bookings/<id>/status` must supply a non-blank reason (≤500 chars); it's persisted on the booking, returned in the API, kept out of the audit log, and the provider UI enforces it with a two-step confirm + required textarea before allowing "Confirm cancel."

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `bookings/models.py`, `bookings/migrations/0002_*`, `bookings/serializers.py`, `bookings/transitions.py`, `bookings/views.py` (status endpoint only, no notification call yet).
**Frontend scope:** `AgendaRow.tsx`, `ProviderCalendar.tsx`.

## Acceptance criteria
- [ ] `Booking.cancellation_reason` (`TextField`, blank/default `""`) + migration `0002_booking_cancellation_reason.py`, additive, no backfill
- [ ] `BookingStatusUpdateSerializer` requires `cancellation_reason` when `status=="cancelled"`; rejects blank, >500 chars, or presence alongside `completed`/`no_show` — all 400
- [ ] `bookings.transitions.transition()` accepts `cancellation_reason`, existing guards (`ALLOWED_TRANSITIONS`, 24h notice) run first unchanged, sets `status`+`cancellation_reason` in one `save(update_fields=[...])` inside existing `atomic()` block
- [ ] `record_audit_event` metadata unchanged except `initiated_by_role`; reason deliberately excluded — add a regression test asserting reason is absent from audit metadata but present on the booking, with a docstring explaining why
- [ ] `BookingSerializer`, `PatientBookingListSerializer` (`/bookings/mine`), `BookingListSerializer` (`/bookings`) all gain read-only `cancellation_reason` (`""` when not cancelled)
- [ ] Patient self-cancel (`PATCH /bookings/<id>/cancel`), `reschedule_booking`'s implicit cancel, and account-deletion's `_cancel_upcoming_appointments` all still leave `cancellation_reason == ""` (regression tests)
- [ ] Tenant isolation regression test: a provider who doesn't own the booking still gets 403/404 on cancel
- [ ] `AgendaRow.tsx`: Cancel becomes two-step (mirrors `AppointmentCard.tsx`'s inline confirm, not a new modal); confirm step shows required `<textarea>` "Reason for cancelling", maxLength 500, helper copy, live char count, "Confirm cancel" disabled while empty/whitespace, busy label "Cancelling…", "Never mind" to back out
- [ ] `onStatusChange` signature widens to `(id, status, cancellationReason?) => Promise<ProviderBooking>`; `ProviderCalendar.tsx`'s `handleStatusChange` sends the reason in the PATCH body and merges only `status`+`cancellation_reason` onto the row (existing merge-only-changed-fields pattern — don't blank `patient_name`)

## Brief anchors
- API: `PATCH /bookings/<id>/status` request/response contract, `bookings.transitions.transition()` choke point, `record_audit_event` metadata rule
- UI/wireframe: `.scratch/wireframes/calendar-option-a.html` reserved zone `[ reserved: cancellation-reason field — parallel story ]` — fill it, don't redesign the dialog
- Note: 24h notice rule and `IsBookingProviderOrAdmin` auth are unchanged — just re-verify with reason present
