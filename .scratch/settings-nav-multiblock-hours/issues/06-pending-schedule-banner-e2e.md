# 06 — Pending schedule banner + end-to-end acceptance test

**What to build:** Build `PendingScheduleBanner` (summary line, optional expander, "Edit pending change" / "Cancel pending change" actions) and wire it above the live-hours form in `WorkingHoursSection`. Write the end-to-end acceptance test: provider sets multi-block hours → patient sees matching slots → provider defers a change → slots before the date use old hours, slots on/after use new.

**Blocked by:** `04`, `05`

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None — covered by tickets 03 and 04
**Frontend scope:** `frontend/components/availability/PendingScheduleBanner.tsx` (new), `frontend/components/availability/PendingScheduleBanner.test.tsx` (new), `frontend/components/availability/WorkingHoursSection.tsx` (wire banner above the live form), `backend/bookings/tests/test_acceptance_journey.py` (end-to-end: multi-block + deferred change + slot boundary assertion)

## Acceptance criteria
- [ ] Banner renders above the live-hours form only when `pending` is non-null in the schedule response.
- [ ] Banner shows: "Scheduled change: new hours take effect Tue, Aug 25 2026 (clinic time)", "Until then, your current hours below stay live for booking.", and a short diff line.
- [ ] "Show full pending schedule ▾" expander reveals a read-only Mon–Sun summary of the pending windows.
- [ ] "Edit pending change" loads the pending windows into the form; saving re-runs the GET/PUT flow and replaces the pending generation.
- [ ] "Cancel pending change" shows an inline one-line confirm, then issues `DELETE /scheduling/schedule/pending`; on success the banner disappears and live hours reload.
- [ ] Banner fetch failure shows a one-line retry inside the banner; the hours form remains usable.
- [ ] E2E acceptance test (extending `test_acceptance_journey.py`): provider saves multi-block hours → patient's bookable slots match those blocks → provider defers a schedule change → `get_open_slots` for dates before `effective_from` returns old hours, on/after returns new hours → both assertions pass in a single query range spanning the boundary.
- [ ] No layout shift when the banner appears or disappears.
- [ ] Component tests: banner visible/hidden based on `pending`, expander toggle, edit flow triggers form load, cancel confirm → DELETE → banner gone, fetch-error retry.

## Brief anchors
- Wireframe Panel 4: `.scratch/wireframes/working-hours-multiblock-wireframe.html`.
- Brief §Frontend `PendingScheduleBanner` (lines 174–178).
- Brief test list E2E (line 195–196).
- Brief §Risks — cancel writes audit entries, no auto-cancel (line 228).
