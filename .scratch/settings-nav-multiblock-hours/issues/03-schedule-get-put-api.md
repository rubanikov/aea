# 03 — Schedule GET/PUT API + generation logic

**What to build:** Implement `GET /scheduling/schedule` and `PUT /scheduling/schedule`: the generation-selection read, the whole-week replace write (per-day overlap / ≥1 h gap / end>start validation, collision detection, deferred-apply path, transactional normalization), the new serializers, and the `get_open_slots` update so slots honour the generation effective on each local date. Retire the three old write endpoints.

**Blocked by:** `02`

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `backend/scheduling/schedule.py` (new — generation selection, `provider_today`, window validation, `earliest_safe_date`, `replace_generation`), `backend/scheduling/slots.py` (`get_open_slots` generation-aware), `backend/scheduling/collisions.py` (`find_schedule_collisions`, refactor `find_availability_collisions` as helper), `backend/scheduling/serializers.py` (add `ScheduleWindowSerializer`, `ProviderScheduleSerializer`, `ScheduleWriteSerializer`, `ScheduleConflictSerializer`; remove old collision-check serializers), `backend/scheduling/views.py` (`ProviderScheduleView`; retire `AvailabilityDetailView` and `AvailabilityCollisionCheckView`), `backend/scheduling/urls.py` (add `scheduling/schedule`; remove three retired routes), `backend/scheduling/tests/test_schedule_api.py` (new — GET/PUT suite), `backend/scheduling/tests/test_slots.py`, `test_collisions.py`, `test_availability_api.py`, `test_availability_collision_api.py` (migrate/extend)
**Frontend scope:** None

## Acceptance criteria
- [ ] `GET /scheduling/schedule` returns `{"timezone", "today", "current": {effective_from, windows}, "pending": null|{…}}` for a provider; `403` for a non-provider; `401` unauthenticated.
- [ ] `current.effective_from` is `null` for the baseline generation; `pending` is `null` when no future generation exists.
- [ ] `PUT /scheduling/schedule` with `effective_from: null` replaces the live generation atomically; live rows are written in one transaction.
- [ ] `PUT` with a future `effective_from` creates/replaces the pending generation; live rows are untouched.
- [ ] Validation returns `400` keyed by day index for overlap, <1 h gap, and end≤start; `effective_from` today or past → `400` on `effective_from`.
- [ ] Collision → `409` with `collisions` list and `earliest_safe_date`; nothing is written.
- [ ] `earliest_safe_date: null` when deferral cannot clear all collisions.
- [ ] `effective_from` earlier than `earliest_safe_date` → `409`.
- [ ] Normalization on write: superseded generations deleted; live generation's `effective_from` set to `NULL`.
- [ ] At most one pending generation at any time (second pending replaces the first).
- [ ] `get_open_slots` returns current-generation hours before `effective_from` and pending-generation hours on/after it.
- [ ] Provider A cannot read or write provider B's schedule; body-supplied `provider` is ignored.
- [ ] Old retired endpoints (`POST /scheduling/availability`, `DELETE /scheduling/availability/<id>`, `POST /scheduling/availability/check-collisions`) return `404` / are removed from urls.

## Brief anchors
- Brief §Background flow (lines 31–41), §API changes (lines 43–144).
- `collisions.DEFAULT_HORIZON_DAYS` = 90 days (unchanged).
- `ScheduleConflictSerializer` reuses `BookingCollisionSerializer` shape verbatim (brief line 125).
- Test list: success cases lines 183–196, failure cases lines 198–218, edge cases lines 210–221.
