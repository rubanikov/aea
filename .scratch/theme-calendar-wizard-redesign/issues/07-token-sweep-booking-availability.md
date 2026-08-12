# 07 — Token sweep: booking-list & availability-management surfaces

**What to build:** The provider's availability-management screens (working hours, appointment types, blocked-time CRUD forms) and the patient/provider booking-list chrome (`RescheduleDialog`, appointment cards/tabs) are restyled onto semantic tokens, with `RescheduleDialog` explicitly staying on its current structural pattern.

**Blocked by:** 01 — Theme mechanism (Light/Dark/System) live across the app shell, 02 — shadcn/ui component foundation adopted in shared chrome, 03 — Provider calendar rebuild: Google Classic Grid week view, 04 — Blocked time visualized on the provider calendar grid, 05 — Patient booking wizard: Provider → Service → Date&Time → Confirm

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** `components/availability/*` (`AppointmentTypeForm.tsx`, `AppointmentTypeRow.tsx`, `AppointmentTypesSection.tsx`, `BlockedTimeForm.tsx`, `BlockedTimeRow.tsx`, `BlockedTimeSection.tsx`, `CollisionWarningModal.tsx`, `DurationSelect.tsx`, `WorkingHoursSection.tsx`), `components/bookings/RescheduleDialog.tsx`, `components/bookings/AppointmentCard.tsx`, `components/bookings/AppointmentTabs.tsx`, `components/bookings/BookingStatusBadge.tsx`, `components/bookings/PatientAppointments.tsx`, `app/patient/appointments/page.tsx`, `app/patient/page.tsx`, `app/provider/page.tsx`

## Acceptance criteria
- [ ] `components/availability/*` restyled onto semantic tokens
- [ ] `components/bookings/RescheduleDialog.tsx` restyled onto tokens **only** — no structural conversion to a new pattern (regression test confirms same DOM/interaction shape)
- [ ] `components/bookings/AppointmentCard.tsx`, `AppointmentTabs.tsx`, `BookingStatusBadge.tsx`, `PatientAppointments.tsx` (dashboard chrome outside the wizard, e.g. list/tab container) restyled onto tokens
- [ ] `app/patient/appointments/page.tsx`, `app/patient/page.tsx`, `app/provider/page.tsx` restyled
- [ ] No hardcoded Tailwind palette classes remain in this file set
- [ ] No structural/behavioral change; existing tests (including `RescheduleDialog.test.tsx`, `AppointmentTabs.test.tsx`) stay green
- [ ] `DayAgenda`/`AgendaRow` (already restyled in `03`) spot-checked for visual consistency with this sweep, no rework needed

## Brief anchors
- API: None — frontend-only
- UI/wireframe: `RescheduleDialog.tsx` and `availability/*` explicitly called out in the brief as restyle-only, no structural change.
- Note: can run in parallel with `06` (disjoint file sets) once `05` lands.
