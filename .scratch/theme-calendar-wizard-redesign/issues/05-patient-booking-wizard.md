# 05 — Patient booking wizard: Provider → Service → Date&Time → Confirm

**What to build:** A patient books an appointment end-to-end through the redesigned stepper (wireframe `booking-option-3-square.html`, reordered): pick provider, pick service (filtered to that provider), pick date/time (reusing the calendar primitives and hatch styling from `03`/`04`), confirm — with a persistent summary rail, correct step-invalidation rules, and preserved dual-timezone labeling.

**Blocked by:** 02 — shadcn/ui component foundation adopted in shared chrome, 03 — Provider calendar rebuild: Google Classic Grid week view, 04 — Blocked time visualized on the provider calendar grid

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None (consumes existing endpoints)
**Frontend scope:** `components/booking/*` (new steps + wizard; old `BookingFlow.tsx`, `ServicePicker.tsx`, `Calendar.tsx`, `TimeSlotGrid.tsx` removed/superseded), wiring into wherever `BookingFlow` currently mounts

## Acceptance criteria
- [ ] New `components/booking/BookingWizard.tsx`, `SummaryRail.tsx`, `ProviderStep.tsx`, `ServiceStep.tsx`, `DateTimeStep.tsx`, `ConfirmStep.tsx`
- [ ] `ServiceStep.tsx` fetches services already filtered to chosen provider via existing `GET /scheduling/providers/<id>/appointment-types`
- [ ] `SummaryRail.tsx` persistent throughout, with per-step edit links
- [ ] Invalidation rule: editing Provider clears Service + selected slot; editing Service clears selected slot only
- [ ] "Any available provider" fast path dropped (no data supports it once provider is chosen first)
- [ ] `DateTimeStep.tsx` reuses `03`/`04`'s calendar primitives and `.hatch-unavailable` utility for unavailable regions; dual-timezone label convention preserved verbatim (provider-zone-primary, patient's own time as secondary line only when the rendered labels differ)
- [ ] `formatTimezone()` used wherever a raw IANA id would show in the wizard
- [ ] `ServicePicker.tsx`, `Calendar.tsx`, `TimeSlotGrid.tsx` (old `components/booking/*`) superseded/folded into the new steps; dead code removed
- [ ] No regression to existing booking rules (slot validity, collision handling) — existing `BookingFlow.test.tsx` coverage carried forward onto the new components
- [ ] Tests: happy-path end-to-end booking, step invalidation rules, provider-scoped service fetching, step-scoped error/empty states, DST correctness on selected slots

## Brief anchors
- API: `GET /scheduling/providers/<id>/appointment-types` (wizard service filtering)
- UI/wireframe: `.scratch/wireframes/booking-option-3-square.html`. Reordering (Provider→Service→Date&Time→Confirm) is the whole point of this ticket — don't preserve the old order "for safety."
- Note: cancellation-reason/SMS business logic is a separate, already-independently-built parallel feature — do not duplicate here.
