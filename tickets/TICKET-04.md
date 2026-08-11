# TICKET-04 — Provider Working Hours, Appointment Types & Slot-Generation Engine

**Blockers:** TICKET-01, TICKET-02
**Scope:** Both
**Size:** Right-sized (widened from the original draft — see note)

## Build
- `Availability` model (day-of-week, start/end time) + provider-facing weekly-hours form.
- **`AppointmentType` model** (`provider_id`, `name`, `duration_minutes`) + CRUD UI — see `architecture.md` §2 and `wireframes.html` Screen 5. Real scheduling durations vary widely by visit type (follow-ups ~10–15 min, new-patient visits ~20–45 min, physicals up to 45–60 min) — there is no single correct default, so this must be provider-configurable, not hardcoded.
- Core compute function: `open_slots = Availability − existing Bookings`, discretized using the **selected AppointmentType's duration** (not a fixed global increment), filtering out past times.
- Endpoint exposing computed slots.
- Explicit DST-transition unit test.

## Accept
- Provider sets Mon–Fri 09:00–17:00 working hours; generated list reflects it correctly.
- Provider defines at least one appointment type with a duration; slots for that type are sized accordingly (e.g. a 15-minute Follow-up type produces 15-minute slots even if a 45-minute New Patient Visit type exists on the same calendar).
- Past times never appear as bookable.
- A slot window spanning a DST transition is generated/totaled correctly — no duplicated/skipped/off-by-one-hour slots (automated test, real Postgres/`zoneinfo`, not mocked).
- Timestamps stored in UTC with a separate provider IANA timezone field — never a naive local string.
- Empty state: a provider with no appointment types configured, or no working hours set, is clearly flagged as "not yet bookable" rather than silently showing zero slots.
- ≥80% test coverage on the generation function.

**Note on sizing:** blocked time is deliberately *not* in this ticket (see TICKET-05).
