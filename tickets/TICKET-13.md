# TICKET-13 — k6 Performance/Load-Test Harness

**Blockers:** TICKET-06, TICKET-07
**Scope:** Backend only (tooling/ops — no new user-facing frontend behavior)
**Size:** Right-sized, a different kind of deliverable than the rest — tooling, not a user-facing slice.

## Build
- k6 scripts (committed) for slot-availability query and booking action at 20–50 VUs/60s.
- Seed-data extension to ~10 providers / ~16,000 computed slots (extends TICKET-01's baseline seed, not a replacement).
- p95 reporting.

## Accept
- Committed script runs against the seeded dataset and reports slot-availability p95 < 1.0s and booking-action p95 < 1.0s.
- Results are reproducible from a clean checkout.
