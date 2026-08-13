# 05 — Multi-block hours form UI + collision modal deferral

**What to build:** Extend `WorkingHoursSection` to support multiple time blocks per day (add/remove blocks, per-day inline validation errors), migrate the form to use `GET`/`PUT /scheduling/schedule`, add the `deferral` prop to `CollisionWarningModal` (date picker + "Apply from" confirm; cancel-only when `earliest_safe_date` is null), and update the frontend types and validation.

**Blocked by:** `03`

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** `frontend/lib/availability/types.ts` (`effective_from` on `AvailabilityDay`, `ScheduleWindow`, `ScheduleGeneration`, `ProviderSchedule`, `ScheduleWriteBody`, `ScheduleConflictBody`), `frontend/lib/availability/validation.ts` + `validation.test.ts` (`WorkingHoursDay`/`WorkingHoursBlock` shape, `validateWorkingHours` multi-block rules with wireframe copy), `frontend/components/availability/WorkingHoursSection.tsx` (multi-block stacks, add/remove block, `GET /scheduling/schedule` load, `PUT /scheduling/schedule` save, 400 inline errors, 409 → modal), `frontend/components/availability/WorkingHoursSection.test.tsx` (new if absent), `frontend/components/availability/CollisionWarningModal.tsx` (optional `deferral` prop — date picker, "Apply from" button, cancel-only path; blocked-time path unchanged), `frontend/components/UIRedesign.acceptance.test.tsx` (update provider "Calendar" label assertion)

## Acceptance criteria
- [ ] Form loads live generation (`GET /scheduling/schedule`) on mount; existing loading / empty / error states are preserved.
- [ ] Each enabled day shows a stack of block rows; "+ Add block" appends one block defaulting to one hour after the previous block's end (or `09:00–17:00` for the first).
- [ ] "✕ Remove" removes a block; removing the last block unchecks the day.
- [ ] Unchecking a day still renders "Unavailable".
- [ ] Save issues `PUT /scheduling/schedule` with `effective_from: null`; "Saving…" spinner and "Working hours saved." confirmation work as today.
- [ ] `400` response maps `windows` day-index keys to per-day `role="alert"` inline errors; focus moves to the first invalid input.
- [ ] `409` with `earliest_safe_date` opens `CollisionWarningModal` with the `deferral` prop; the date picker min and default equal `earliestSafeDate`; the confirm button reads "Apply from Aug 25" (date interpolated).
- [ ] `409` with `earliest_safe_date: null` opens the modal with cancel-only (no date picker, explanatory line).
- [ ] Blocking: client-side validation fires before any request; overlap, <1 h gap, and end≤start show the wireframe copy messages.
- [ ] "12:00–13:00" is valid (exactly one hour); "12:00–12:00" is invalid.
- [ ] `CollisionWarningModal` blocked-time path (`deferral` absent) is unchanged.
- [ ] `validateWorkingHours` unit tests cover all three error messages including gap-time interpolation.
- [ ] Component tests: multi-block render, add/remove block, 400 inline errors, 409 modal deferral flow, 409 cancel-only path.

## Brief anchors
- Wireframe: `.scratch/wireframes/working-hours-multiblock-wireframe.html`.
- Brief §Frontend Story 2 — types (line 162), validation (lines 163–166), `WorkingHoursSection` (lines 168–172), `CollisionWarningModal` (lines 173–174).
- Validation copy verbatim: brief lines 164–166.
