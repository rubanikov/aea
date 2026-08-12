# 02 — Patient sees the cancellation reason on their booking

**What to build:** A patient viewing a cancelled booking sees the doctor's reason under the date/time.

**Blocked by:** 01 — needs `cancellation_reason` persisted and exposed on `/bookings/mine`.

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None — API contract already delivered by 01.
**Frontend scope:** `AppointmentCard.tsx`, `lib/bookings/types.ts`.

## Acceptance criteria
- [ ] `AppointmentCard.tsx`: on a cancelled booking with non-empty `cancellation_reason`, render "Cancelled — reason: {reason}" under date/time with `white-space: pre-wrap`
- [ ] Nothing renders when `cancellation_reason` is empty (patient-initiated cancels have none)
- [ ] `lib/bookings/types.ts`: `PatientBooking` gains `cancellation_reason: string`

## Brief anchors
- API: `/bookings/mine` (`PatientBookingListSerializer.cancellation_reason`, read-only) — shipped by ticket 01
- UI/wireframe: notification content is deliberately minimal (statement + date/time + reason + link) — no patient/provider/appointment-type names; this ticket only concerns the in-app card display, not the notification itself
- Note: this is a frontend-only ticket because its backend dependency ships entirely in 01; there is no new backend surface for this behaviour
