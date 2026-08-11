# TICKET-10 — Reschedule Appointment

**Blockers:** TICKET-09
**Scope:** Both
**Size:** Right-sized

## Build
- Reschedule endpoint — atomically frees the old slot and books the new one, reusing TICKET-07's guard on the new slot so a reschedule can't itself create a double-booking.
- Same notice-rule enforcement as cancel.
- "Reschedule" action added to the "My Appointments" UI from TICKET-09 — extend that ticket's appointment-card component, don't rebuild it.

## Accept
- Patient moves an appointment to another open slot; old slot becomes bookable again.
- Reschedule inside the notice window is rejected server-side.
- A reschedule racing another patient for the target slot resolves the same way TICKET-07 guarantees (exactly one winner).
- ≥80% coverage on reschedule rules.
