# 04 — Blocked time visualized on the provider calendar grid

**What to build:** The provider sees their blocked-time ranges (vacations, breaks) rendered as hatched regions on the week grid from `03`, non-interactively, clipped correctly per day/hour, with bookings inside them staying legible and clickable, plus graceful failure handling.

**Blocked by:** 03 — Provider calendar rebuild: Google Classic Grid week view

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None (consumes existing `GET /scheduling/blocked-time`)
**Frontend scope:** `hooks/use-provider-blocked-time.ts` (new), `components/calendar/BlockedTimeRegion.tsx` (new), `lib/calendar/layout.ts`, `app/globals.css` (`.hatch-unavailable` utility)

## Acceptance criteria
- [ ] New `hooks/use-provider-blocked-time.ts` (mirrors `use-provider-availability`), mount-keyed, holds full unfiltered list, filters to visible week client-side via `block.start < weekEnd && block.end > weekStart`
- [ ] Reuses existing `BlockedTime` type at `lib/availability/types.ts:55` — no duplicate type created
- [ ] New `components/calendar/BlockedTimeRegion.tsx`; hatch styling expressed as shared `.hatch-unavailable` utility class (reused verbatim from wireframe's `.busy`/`.ghost` diagonal-gradient rule) — this class must be the single source consumed later by the patient slot-picker too
- [ ] `lib/calendar/layout.ts` extended with blocked-region positioning, same DST-safe independent-endpoint-conversion rule as booking geometry
- [ ] Multi-day block paints a separate region per affected day column; clipped to visible-hour range
- [ ] Z-order: beneath booking blocks; hatch has `pointer-events: none` so bookings inside a blocked window stay clickable
- [ ] Non-interactive this pass — no click target on the hatch itself
- [ ] Accessibility: hatch element `aria-hidden`, paired with visually-hidden text naming the clipped/truncated range ("Blocked: Vacation, 9:00am–5:00pm" / "Blocked, 9:00am–5:00pm" when label empty)
- [ ] Empty state: nothing renders when there's no blocked time
- [ ] Failure state: non-blocking inline note ("Couldn't load your blocked time — the grid may show hours that are actually blocked.") + scoped "Try again" re-firing only this fetch; never falsely renders something as blocked
- [ ] Zero extra requests fired on week navigation (mount-keyed, not weekStart-keyed)
- [ ] Tests: multi-day per-column clipping, all-day block, DST-spanning block, edge-truncation, fetch-once-per-mount + degrade + retry, accessible-name correctness including empty label, z-order/clickability

## Brief anchors
- API: `GET /scheduling/blocked-time` (no params, provider's entire unfiltered blocked-time history, owner-scoped, `{id, start, end, label}` UTC ISO instants ordered by start)
- UI/wireframe: `.scratch/wireframes/calendar-option-a.html` `.busy`/`.ghost` diagonal-gradient hatch rule.
- Note: `.hatch-unavailable` is a hard dependency for ticket `05`'s `DateTimeStep` — do not let it drift from this ticket's implementation. Blocked time in scope, non-interactive — already resolved by prior gate.
