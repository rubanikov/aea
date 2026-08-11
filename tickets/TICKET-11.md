# TICKET-11 — Availability-Edit Collision Protection (Edge Case 3)

**Blockers:** TICKET-05, TICKET-07
**Scope:** Both
**Size:** Right-sized

## Build
- Diff logic on provider availability/blocked-time edits (shrink hours, change slot length, add a block) against existing confirmed bookings.
- Reject with a message listing affected appointments, or accept while preserving the booked slot and flagging it for follow-up.
- **Collision-warning modal UI** (widened scope — see `wireframes.html` Screen 7): lists affected confirmed appointments, offers a radio-button choice ("keep new hours, honor these as flagged exceptions" vs. "cancel this change"), surfaced from both the working-hours form (TICKET-04) and the blocked-time form (TICKET-05). This is not just a backend 409 — the modal itself is part of this ticket's definition of done.

## Accept
- An edit that would silently orphan or double-book a confirmed appointment is either rejected (with the specific affected appointments listed) or applied while explicitly preserving/flagging that booking — never a silent delete or silent double-book.
- The collision modal renders the affected appointments using the same status-badge convention as the rest of the app (icon + text, not color alone).
- No-collision edits save with no modal interruption.
