# 01 — Expand backend to 133-day seed and collision horizon

**What to build:** Demo seed and collision defaults both use a 133-day horizon with updated expected counts (16,150 gross slots, 305 sample bookings); tests and comments match the 60-day slot-query cap and new default scan window.

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `seed_demo.py`, `test_seed_demo.py`, `collisions.py`, `test_collisions.py`, `views.py` (comments), `test_schedule_api.py` (comments)
**Frontend scope:** None

## Acceptance criteria
- [ ] `seed_demo.HORIZON_LENGTH_DAYS` is **133**; `WEEKLY_HORIZON_LENGTH_DAYS` (35), `BOOKING_SAMPLE_STEP` (20), and `MAX_SLOT_QUERY_RANGE_DAYS` (60) unchanged
- [ ] Seed expectations: `EXPECTED_GROSS_SLOT_TOTAL` **16150**, `EXPECTED_BOOKING_COUNT` **305** (per-provider sample counts per brief: 34,34,29,34,24,34,24,24,34,34)
- [ ] Weekly cohort unchanged: 5 doctors, 20 patients, 500 bookings; provider/account counts unchanged (15 providers, 25 patients)
- [ ] Same-day seed idempotency still passes
- [ ] `collisions.DEFAULT_HORIZON_DAYS` is **133** (was 90)
- [ ] Collision tests: booking at **+120 days** included under default horizon; booking at **+134** (or +140) excluded; existing tests with explicit `horizon_days=90` still pass
- [ ] `PUT /scheduling/schedule` and `POST blocked-time` still return **409** with collision list shape `{id, start_time, end_time, patient_name, appointment_type_name, status}` and `earliest_safe_date` on schedule PUT; day **134+** still unprotected
- [ ] Comments corrected: `seed_demo.py` does **not** claim the full 133-day horizon is one `GET /scheduling/slots` call (60-day cap documented); `views.py` and `test_schedule_api.py` **90→133** comments updated
- [ ] `pytest backend/core/tests/test_seed_demo.py backend/scheduling/tests/test_collisions.py` passes (accept ~2.4× slower seed tests)

## Brief anchors
- API: collision horizon default 133 days; schedule/blocked-time 409 shape unchanged; slot query 60-day cap documented separately from seed horizon
- UI/wireframe: None
