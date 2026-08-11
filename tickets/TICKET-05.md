# TICKET-05 — Provider Blocked Time & Slot Exclusion

**Blockers:** TICKET-04
**Scope:** Both
**Size:** Right-sized

## Build
- `BlockedTime` model (date-range scoped) + provider UI to add/remove blocks (see `wireframes.html` Screen 6).
- Generation engine from TICKET-04 extended to subtract blocked ranges.

## Accept
- Provider blocks a specific range; that range's slots disappear from the computed open-slot list immediately.
- Blocked ranges never appear as bookable regardless of underlying working hours.
- Empty state: "No blocked time yet" renders cleanly, not blank/broken.
