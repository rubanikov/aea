# 04 — DELETE pending schedule + availability narrowing

**What to build:** Implement `DELETE /scheduling/schedule/pending` (discard the pending generation, write `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entries for any bookings that no longer fit live hours), narrow `GET /scheduling/availability` to return only the live generation's rows, and complete the backend test suite (schedule, slots, collisions, acceptance journey migration).

**Blocked by:** `03`

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `backend/scheduling/views.py` (`PendingScheduleView`; narrow `AvailabilityListCreateView` to `GET` only), `backend/scheduling/urls.py` (add `scheduling/schedule/pending`), `backend/scheduling/tests/test_schedule_api.py` (DELETE suite), `backend/scheduling/tests/test_slots_api.py`, `test_slots.py`, `test_collisions.py` (remaining edge-case coverage), `backend/bookings/tests/test_acceptance_journey.py` (replace five per-day POSTs with one `PUT /scheduling/schedule`)
**Frontend scope:** None

## Acceptance criteria
- [ ] `DELETE /scheduling/schedule/pending` returns `204`; live rows are untouched.
- [ ] `DELETE` with no pending change returns `404 {"detail": "No pending schedule change."}`.
- [ ] One `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entry is written per booking that was made under the pending hours and no longer fits the restored live hours (no auto-cancel).
- [ ] `DELETE` is provider-only: `403` for non-provider, `401` unauthenticated.
- [ ] `GET /scheduling/availability` returns only the live generation's rows while a pending generation exists; `effective_from` is present on each window.
- [ ] Acceptance journey test uses `PUT /scheduling/schedule` (not the retired per-day POSTs); all existing assertions still pass.
- [ ] Edge-case tests: second pending change replaces the first; editing live hours while a pending change exists; DST-boundary slot resolution; provider-local "today" differs from UTC today; `windows: []` (no hours); booking on the effective-date local-midnight boundary; pending date passed without a write (treated as live).

## Brief anchors
- Brief §API `DELETE /scheduling/schedule/pending` (lines 130–136).
- Brief §API `GET /scheduling/availability` semantics narrowed (lines 138–142).
- Brief §Risks — cancelling a pending change writes audit entries, never auto-cancels (line 228).
- Brief §Retired endpoints (lines 143–144).
- Test list edge cases (lines 210–221), acceptance journey (line 196, 252).
