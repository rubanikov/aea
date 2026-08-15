# 02 — Re-run k6, re-seed Railway, close audit gaps

**What to build:** Update k6 horizon offsets for the 133-day seed, run load tests and Railway re-seed, and close remaining audit items (graceful degradation, cited counts).

**Blocked by:** 01 — Expand backend to 133-day seed and collision horizon

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None (product code done in `01`)
**Frontend scope:** None

## Acceptance criteria
- [ ] `k6/helpers.js`: `HORIZON_END_OFFSET_DAYS` **54→131**; comment updated to match 133-day horizon
- [ ] After local seed with expanded horizon, k6 run: `VUS=30`, `DURATION=60s`; thresholds stay **`p(95)<1000`** (not weakened)
- [ ] `k6/README.md` updated with measured p95; runserver/local caveat retained; local p95 >1s documented but **does not block** merge
- [ ] `railway run python manage.py seed_demo` succeeds idempotently (adds days 57–133 without duplicating existing data)
- [ ] `audits/audit_20260813_1744.md`: graceful-degradation marked **closed** (health **503** + Resend skip/retry already meet spec); seed slot/booking counts reflect 133-day horizon where cited

## Brief anchors
- API: depends on ticket 01 seed/collision horizon
- UI/wireframe: None
