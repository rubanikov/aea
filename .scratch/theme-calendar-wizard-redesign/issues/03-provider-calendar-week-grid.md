# 03 — Provider calendar rebuild: Google Classic Grid week view

**What to build:** A provider opens their calendar and sees the redesigned week grid (wireframe `calendar-option-a.html`): visible hour range computed from availability + bookings, correctly positioned appointment blocks, DST-safe geometry, both zero-availability states handled, and cancelling a booking now goes through a confirm step with a reserved region for a future reason field. The existing mobile day-agenda fallback is restyled to match.

**Blocked by:** 02 — shadcn/ui component foundation adopted in shared chrome

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None (consumes existing `GET /scheduling/availability`)
**Frontend scope:** `components/calendar/*` (new), `lib/calendar/hours.ts`, `lib/calendar/layout.ts` (new), `hooks/use-provider-availability.ts` (new), `components/bookings/ProviderCalendar.tsx`, `components/bookings/DayAgenda.tsx`, `components/bookings/AgendaRow.tsx`

## Acceptance criteria
- [ ] New primitives: `components/calendar/TimeGrid.tsx`, `HourRuler.tsx`, `WeekGridHeader.tsx`, `MiniMonth.tsx`, `AppointmentBlock.tsx`
- [ ] `lib/calendar/layout.ts`: pure booking-block positioning geometry, DST-safe (start/end converted independently in provider's zone, never one endpoint derived from the other via UTC duration)
- [ ] `lib/calendar/hours.ts:visibleHourRange(availability, weekdayIndices, bookings, timezone)`: configured availability (floored/ceiled to whole hours) forms base range, EXTENDED never clipped by out-of-hours bookings, `MIN_VISIBLE_HOURS = 4` floor
- [ ] New `hooks/use-provider-availability.ts`, mount-keyed (not weekStart-keyed); on failure, grid still renders bounded by bookings alone + scoped inline warning + "Try again" (re-fires only this fetch)
- [ ] Two distinct zero-availability states handled and tested: no-hours+no-bookings (prompt to configure) vs no-hours+bookings-exist (renders around bookings + nudge)
- [ ] Existing `GET /profile` and `GET /bookings` (`weekStart`-keyed) fetches preserved as hard blockers; `handleStatusChange`'s status-only merge preserved exactly (regression test)
- [ ] Provider cancel action gets a confirm step (mirrors patient-side pattern) with a reserved empty region sized for a future reason field — no reason logic built, region genuinely empty
- [ ] Existing `DayAgenda.tsx`/`AgendaRow.tsx` narrow-screen fallback restyled onto tokens only, no structural/behavioral change; existing tests stay green
- [ ] Week nav (prev/next) triggers no extra availability/profile fetches (mount-keyed, not weekStart-keyed)
- [ ] Timezone: grid renders entirely in provider's own zone from `GET /profile`; `formatTimezone()` used wherever a raw IANA id would show
- [ ] Unit tests: visible-hour-range (extend-not-clip, floor), booking-block geometry, DST correctness

## Brief anchors
- API: `GET /profile` (mount-keyed, hard blocker), `GET /bookings` (`weekStart`-keyed, hard blocker, existing — preserve merge exactly), `GET /scheduling/availability` (mount-keyed, graceful degrade)
- UI/wireframe: `.scratch/wireframes/calendar-option-a.html`. Day/Week toggle resolved — week view only, no working desktop Day toggle this pass.
- Note: `MIN_VISIBLE_HOURS = 4` already accepted by prior gate — do not re-litigate.
