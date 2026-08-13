# 02 — Availability model migration

**What to build:** Add the `effective_from` nullable `DateField` to `scheduling.Availability`, create the migration, update `Meta.ordering` with `nulls_first`, add the composite index, and surface `effective_from` through `AvailabilitySerializer`. Existing rows keep `NULL` (the live baseline); behaviour is unchanged until a provider saves.

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `backend/scheduling/models.py` (field, index, `Meta.ordering`), `backend/scheduling/migrations/0004_availability_effective_from.py` (new — AddField + AddIndex + AlterModelOptions), `backend/scheduling/serializers.py` (`AvailabilitySerializer` gains `effective_from`), `backend/scheduling/admin.py` (`effective_from` in `list_display`/`list_filter`), `backend/scheduling/tests/test_models.py` (ordering and `effective_from` field tests)
**Frontend scope:** None

## Acceptance criteria
- [ ] Migration applies cleanly on a fresh DB and on a DB with existing `Availability` rows.
- [ ] Existing rows keep `effective_from = NULL` after migration; no backfill.
- [ ] `Meta.ordering` is `[F("effective_from").asc(nulls_first=True), "day_of_week", "start_time"]` — `NULL` rows sort first.
- [ ] Index `availability_provider_gen_idx` on `["provider", "effective_from", "day_of_week"]` is created by the migration.
- [ ] `GET /scheduling/availability` response includes `effective_from` on each window (serializer change only — behaviour narrowing comes in ticket 04).
- [ ] Existing `availability_start_before_end` CheckConstraint is preserved.
- [ ] `AvailabilityAdmin` shows `effective_from` in list and filter.
- [ ] `test_models.py` covers the new ordering and field presence.

## Brief anchors
- Brief §Data model changes (lines 7–19).
- Migration file path: `backend/scheduling/migrations/0004_availability_effective_from.py`.
- No new tables, no new third-party dependencies (brief line 25).
