# TICKET-08 — Status Lifecycle Transitions + Provider Calendar View

**Blockers:** TICKET-07
**Scope:** Both
**Size:** Right-sized

## Build
- `AppointmentStatus` closed enum, `ALLOWED_TRANSITIONS` guard, single `transition()` write path (also writes the TICKET-03 audit entry) — see `architecture.md` §4.
- Provider-facing calendar/list view (see `wireframes.html` Screen 8): a **week-strip + day-grouped agenda list**, not a FullCalendar-style drag-and-drop grid — deliberately simpler, and far easier to make fully keyboard-navigable.
- Role-appropriate status actions: **mark completed, mark no-show, cancel**. There is **no Confirm/Decline action** — bookings arrive pre-confirmed from TICKET-07's auto-accept, so every row this screen shows is already `CONFIRMED` (or a later terminal state).

## Accept
- Transitions only along `requested→confirmed→completed/cancelled/no_show`; e.g. a cancelled appointment cannot become completed — rejected server-side with a clear error.
- `no_show` only settable on a `confirmed` booking whose start time has passed.
- Every transition writes an audit entry (actor/action/target/timestamp).
- Status is shown in the UI with text/icon, not color alone.
- Provider calendar has no confirm/decline UI anywhere — only complete/no-show/cancel actions on confirmed rows.
- Empty state: no appointments for a given day/week renders cleanly.
- ≥80% coverage on transition logic.
