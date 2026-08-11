# TICKET-06 — Patient Slot Discovery (Browse Open Slots)

**Blockers:** TICKET-05, TICKET-02
**Scope:** Both
**Size:** Right-sized

## Build
- `GET` endpoint returning genuinely open, future slots for a chosen provider + appointment type, reusing TICKET-04/05's engine.
- Patient-facing browse/picker UI (see `wireframes.html` Screen 2 date-picker + slot-list half): appointment-type picker (service selection, showing name + duration), date picker, grouped time-slot buttons.
- Dual-timezone display: slots shown in the patient's local timezone with the provider's timezone surfaced alongside (e.g. "Provider is in America/New_York").

## Accept
- Patient (authenticated) sees only open, future slots for the selected provider + appointment type.
- Each slot displays unambiguously in the patient's local zone regardless of the provider's zone.
- Appointment-type picker shows each type's name and duration (e.g. "Follow-up (15 min)").
- No booking action yet (that's TICKET-07) — this ticket's observable behavior is a correct, live, timezone-correct slot list.
- Empty state: provider with no availability/no appointment types configured shows a clear message, not a blank grid.
