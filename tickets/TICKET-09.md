# TICKET-09 — Cancel Appointment (Notice Rule) + Patient "My Appointments" UI

**Blockers:** TICKET-08
**Scope:** Both
**Size:** Right-sized

## Build
- Cancel endpoint (routes through TICKET-08's `transition()`), server-side minimum-notice rule (e.g. no cancel < 24h before start).
- Patient "My Appointments" list page (see `wireframes.html` Screen 3): upcoming/past/cancelled tabs, status badges (icon + text), cancel action.
- A small placeholder/slot in the card layout for the "reminder sent" indicator — TICKET-12 owns filling it in, this ticket just needs to leave room so 12 doesn't have to touch the card component again.

## Accept
- Patient can cancel; cancelling frees the slot atomically (immediately rebookable).
- A cancel attempt inside the notice window is rejected server-side with a clear error and disabled UI state explaining why (not merely disabled client-side with no explanation).
- Empty state: "You don't have any appointments yet" renders cleanly with a path to book.
- ≥80% coverage on cancel rules.
