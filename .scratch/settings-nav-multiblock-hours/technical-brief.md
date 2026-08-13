# Technical brief — Portal nav on `/settings` + multi-block hours with deferred apply

Stories 1 and 2 are independent except that both touch provider naming (`ROLE_NAV.provider`). Backend work is entirely Story 2.

## Data model changes

**`scheduling.Availability` — one new column.**

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `effective_from` | `DateField` | yes (default `NULL`) | Calendar date **in `provider.timezone`** on which this row's generation starts. `NULL` = the baseline generation, in effect since the beginning of time. |

- **Generation model.** A provider's rows partition into *generations* keyed by `effective_from`. The schedule in effect on provider-local date `D` is the generation with the greatest `effective_from <= D`, treating `NULL` as `-infinity`. This makes the deferred switch a pure read-time computation — **no promotion job, no scheduler.**
- **Invariant (application layer):** at most one generation whose `effective_from` is strictly after today in `provider.timezone`. That one is "the pending change". Not expressible as a DB constraint (it's cross-row and time-dependent); enforced in `ProviderScheduleView` and covered by a test.
- **Normalization on every write:** inside the same transaction, delete every generation older than the currently-effective one, then set the effective one's `effective_from` to `NULL`. Steady state is therefore at most two generations: `NULL` (live) and one future date (pending). Reads still use the general rule above, because normalization only runs on writes.
- `Meta.ordering` becomes `[F("effective_from").asc(nulls_first=True), "day_of_week", "start_time"]` — Postgres sorts `NULL` last by default, which would put the baseline after dated generations.
- New index: `models.Index(fields=["provider", "effective_from", "day_of_week"], name="availability_provider_gen_idx")`.
- Existing `availability_start_before_end` CheckConstraint stays. The same-day **no-overlap** and **≥1 hour separation** rules are cross-row and stay at the application layer (serializer + client), not the DB.
- Migration: `backend/scheduling/migrations/0004_availability_effective_from.py` — `AddField` + `AddIndex` + `AlterModelOptions`. No backfill: existing rows keep `NULL` and remain the live baseline, so behaviour is unchanged for every provider until they save.

**Tenant boundary.** The tenant unit here is the provider (`accounts.User` with `role=provider`). Every read and write is scoped by `provider=request.user`; `provider` is never a serializer field and never read from the request body (same rule `AvailabilitySerializer` already documents). `effective_from` never widens that scope — a provider can only ever create, replace, or delete generations under their own `provider_id`. Cross-provider access on the detail paths stays with `audit.permissions.IsOwnerOrAdmin`.

**Timezones.** `start_time`/`end_time` remain naive wall-clock `TimeField`s resolved to UTC per date at slot-generation time — unchanged. `effective_from` is a pure calendar date with no instant conversion, so it has no DST hazard. "Today" and "future" are always `django_timezone.now().astimezone(ZoneInfo(provider.timezone)).date()`. The date is displayed to the provider labelled "clinic time"; it is never converted to the patient's timezone.

No new tables, no new database, no new third-party dependency.

## Background flow / process flow

Everything is synchronous request/response. Nothing is queued, retried, or backgrounded, and no new scheduler, cron, or job runner is introduced.

**Saving working hours (`PUT /scheduling/schedule`):**

1. Validate the weekly window set: per day, `end > start`, no overlaps, and ≥60 minutes between the end of one block and the start of the next (touching blocks are invalid). Reject with 400 before anything is read from the DB.
2. Resolve `provider_today` and validate `effective_from`: `null`, or a date strictly after `provider_today`.
3. Build the **proposed timeline** — the list of generations that would exist after the write. `effective_from: null` replaces the live generation and leaves any pending one in place; a date creates or replaces the pending generation and leaves the live one untouched.
4. `find_schedule_collisions(provider, timeline)`: for each active booking in the next 90 days (`collisions.DEFAULT_HORIZON_DAYS`, unchanged), pick the generation effective on that booking's provider-local start date and check whether the booking falls entirely inside one of its windows.
5. Collisions → **409, nothing written**, body carries the collisions plus `earliest_safe_date`.
6. No collisions → one `transaction.atomic()` block: normalize old generations, delete the target generation's rows, `bulk_create` the new ones. Whole-schedule replace, so there is no partial-failure state — this removes the existing per-day DELETE-then-POST sequence that could half-apply.
7. Audit (`audit.services.record_audit_event`, actor = the provider): `update:availability_schedule` for an immediate apply, `schedule:availability_change` with `{"effective_from": ...}` for a deferred one, `cancel:availability_pending_change` for a discard. Naming follows the existing `create:blocked_time` convention — confirm under open questions.

**The deferred switch itself** happens with no process at all: on and after `effective_from`, `get_open_slots` selects the newer generation for that date. `bookings.services.create_booking` re-validates through `get_open_slots`, so booking creation and reschedule inherit date-awareness for free.

## API changes

All paths are under the existing DRF app; default `IsAuthenticated` applies. `401` for no session throughout.

### `GET /scheduling/schedule` (new)

Provider's own schedule. `403 {"detail": "Only providers can configure working hours."}` for non-providers.

```json
200 OK
{
  "timezone": "America/New_York",
  "today": "2026-08-12",
  "current": {
    "effective_from": null,
    "windows": [
      {"id": 12, "day_of_week": 0, "start_time": "09:00:00", "end_time": "17:00:00"}
    ]
  },
  "pending": {
    "effective_from": "2026-08-25",
    "windows": [
      {"id": 41, "day_of_week": 0, "start_time": "09:00:00", "end_time": "12:00:00"},
      {"id": 42, "day_of_week": 0, "start_time": "14:00:00", "end_time": "17:00:00"}
    ]
  }
}
```

- `current` is the generation effective on `today`; `current.effective_from` is `null` for the baseline, otherwise the date it started. `current.windows` may be `[]` (provider has no hours).
- `pending` is `null` when no generation has `effective_from > today`.
- Windows sorted by `day_of_week`, then `start_time`.
- `today` is the provider-local date, supplied so the client never derives it from the browser clock.

### `PUT /scheduling/schedule` (new)

Replaces one whole weekly generation. Provider-only (`403` otherwise).

```json
{
  "windows": [
    {"day_of_week": 0, "start_time": "09:00", "end_time": "12:00"},
    {"day_of_week": 0, "start_time": "14:00", "end_time": "17:00"}
  ],
  "effective_from": null
}
```

- `windows` — required, the complete weekly picture. A day absent means "no hours that day"; `[]` means no hours at all. `start_time`/`end_time` accept `"HH:MM"` and `"HH:MM:SS"`.
- `effective_from` — required key, `null` (apply now, replacing the live generation) or `"YYYY-MM-DD"` strictly after `today` in `provider.timezone` (create or replace the pending generation).

**200 OK** — body is exactly the `GET /scheduling/schedule` shape, post-write.

**400 Bad Request** — schedule-rule violations are keyed by day index so the client can render them inline:

```json
{"windows": {"0": ["Blocks on the same day can't overlap."]}}
{"windows": {"1": ["Blocks on the same day must be at least 1 hour apart."]}}
{"windows": {"3": ["End time must be after start time."]}}
{"effective_from": ["Effective date must be a future date in your timezone."]}
```

Malformed payloads (bad time format, missing key, `day_of_week` outside 0–6) fall through to DRF's default index-keyed errors; the client shows a form-level message for those.

**409 Conflict** — nothing written:

```json
{
  "collisions": [
    {
      "id": 41,
      "start_time": "2026-08-17T17:00:00Z",
      "end_time": "2026-08-17T18:00:00Z",
      "patient_name": "Pat Patient",
      "appointment_type_name": "Initial consultation",
      "status": "confirmed"
    }
  ],
  "earliest_safe_date": "2026-08-25"
}
```

- `collisions` reuses the existing `BookingCollisionSerializer` shape verbatim — no new frontend vocabulary.
- `earliest_safe_date` = the day after the latest colliding booking's provider-local **end** date, floored at `today + 1 day`. It is the `min` and the default for the date picker.
- `earliest_safe_date` is **`null`** when deferring cannot clear every collision (a collision governed by a *different* generation than the one being written, e.g. an immediate edit whose conflicts sit past an existing pending date). The client then offers only "Cancel this change".
- Returned both when `effective_from` is `null` and an immediate apply would strand bookings, and when a supplied `effective_from` is earlier than the earliest safe date (server-side enforcement of the picker's `min`).

### `DELETE /scheduling/schedule/pending` (new)

Discards the pending generation. Provider-only.

- `204 No Content` on success. Live hours untouched.
- `404 {"detail": "No pending schedule change."}` when there is none.
- No collision check (see open questions); writes one `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entry per booking that was made under the pending hours and no longer fits the restored live hours.

### `GET /scheduling/availability` (existing — semantics narrowed)

Now returns **only the currently-effective generation's rows**, each with `effective_from` added to the payload. This preserves what every existing consumer means by it ("the hours that are live today") and prevents the provider calendar's hour bounds from double-counting pending rows.

### Retired

`POST /scheduling/availability`, `DELETE /scheduling/availability/<id>`, and `POST /scheduling/availability/check-collisions` are removed, along with `AvailabilityCollisionCheckSerializer` and `ProposedAvailabilityWindowSerializer`. They are the only write paths that could inject a row into the wrong generation or bypass the overlap/gap rules, and `PUT /scheduling/schedule` supersedes all three. `BlockedTime`'s collision flow, `find_blocked_time_collisions`, and `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` are untouched.

## Frontend changes

Wireframes are the layout source of truth: `.scratch/wireframes/settings-portal-nav-wireframe.html` and `.scratch/wireframes/working-hours-multiblock-wireframe.html`. Follow their layout and states; any intentional deviation goes under open questions.

### Story 1 — portal nav on `/settings`

- **`app/settings/layout.tsx` (new)** — thin file rendering `<SettingsShell>{children}</SettingsShell>`. URL stays `/settings`.
- **`components/nav/SettingsShell.tsx` (new, `"use client"`)** — resolves the role with `useCurrentUser()` and renders `<AppShell role={...}>`. Mapping: `undefined` (in flight) → `null`; `"provider"` → `provider`; `"admin"` → `admin`; **everything else, including `null` after a failed fetch, → `patient`** (providers are always admin-assigned, so an unknown role is a patient). Never renders a role's nav before the role is known.
- **`components/nav/AppShell.tsx`** — becomes `"use client"`; `role` widens to `Role | null`.
  - `role === null` (wireframe Panel C): render the header at full height with `aria-busy="true"`, an `aria-hidden` placeholder where the portal label goes, no `<nav>` element and no links. `ThemeToggle` and `UserBadge` still render. No layout shift when links appear.
  - Marks the current page with `aria-current="page"` via `usePathname()`, exact match on `link.href` (so `/provider` and `/provider/calendar` are never both current).
- **`lib/nav-config.ts`** — provider's first link label `"Calendar"` → `"Dashboard"`; `href` stays `/provider/calendar`. Update the block comment, which currently explains the old "Availability vs Calendar" naming.
- **`app/settings/page.tsx`** — keep the "Back to dashboard" link; change `ROLE_HOME.provider` from `/provider` to `/provider/calendar` so the link and the Dashboard nav item agree. Content is otherwise unchanged.

### Story 2 — multi-block hours + deferred apply

- **`lib/availability/types.ts`** — add `effective_from: string | null` to `AvailabilityDay`; add `ScheduleWindow`, `ScheduleGeneration`, `ProviderSchedule`, `ScheduleWriteBody`, and `ScheduleConflictBody` (`{collisions, earliest_safe_date}`).
- **`lib/availability/validation.ts`** — `WorkingHoursRow` becomes `WorkingHoursDay { day, enabled, blocks: WorkingHoursBlock[] }` with `WorkingHoursBlock { key, startTime, endTime }` (`key` is a client-only React key). `validateWorkingHours` returns one message per day, in wireframe copy:
  - `"End time must be after start time."`
  - `"These blocks overlap. Blocks on the same day can't share any time."`
  - `"Blocks must be at least 1 hour apart. There are only 30 minutes between 12:00 and 12:30."` (interpolate the real gap and times.)
  - 12:00 → 13:00 is valid (exactly one hour). 12:00 → 12:00 is invalid.
- **`components/availability/WorkingHoursSection.tsx`** — extended, not redesigned.
  - Loads `GET /scheduling/schedule`; the form always shows the **live** generation.
  - Each enabled day renders a stack of block rows (same `<input type="time">` pair), a per-block `✕ Remove`, and one `+ Add block`. Unlimited blocks. New block defaults to one hour after the previous block's end, or `09:00–17:00` for the first. Removing the last block unchecks the day. Unchecking a day still shows "Unavailable".
  - Save → single `PUT /scheduling/schedule` with `effective_from: null`. On 409 with `earliest_safe_date`, open the collision modal; on 400, map `windows` day keys to inline per-day `role="alert"` errors and focus the first invalid input.
  - Loading, empty ("You haven't set your working hours yet." + Set-up button focusing Monday), load error + Try again, `Saving…`, and "Working hours saved." all stay exactly as today.
- **`components/availability/CollisionWarningModal.tsx`** — same alertdialog, focus trap, ×/Esc/"Go back" = cancel. New optional `deferral` prop `{ earliestSafeDate: string; timezone: string; onApplyFrom: (date: string) => void }`. When present, the first radio becomes **"Apply the new hours from a future date"** with an embedded `<input type="date">` (`min` and default = `earliestSafeDate`, later dates allowed), a hint naming the earliest safe date and the clinic timezone, and a confirm button labelled `Apply from Aug 25`. When absent — `BlockedTimeSection`'s call — the existing "Keep new hours" radio renders unchanged. When the server returns `earliest_safe_date: null`, render only "Cancel this change" plus a line explaining the change can't be deferred.
- **`components/availability/PendingScheduleBanner.tsx` (new)** — above the live hours (wireframe Panel 4). One-line summary: `Scheduled change: new hours take effect Tue, Aug 25 2026 (clinic time)` plus `Until then, your current hours below stay live for booking.` and a short diff line. Optional `Show full pending schedule ▾` expander with a read-only Mon–Sun summary. Two actions:
  - **Edit pending change** — loads the pending windows into the form; saving re-runs the same flow and replaces the pending change (one at a time).
  - **Cancel pending change** — inline one-line confirm, then `DELETE /scheduling/schedule/pending`.
  - Banner fetch failure shows a one-line retry inside the banner; the form stays usable.
- **`hooks/use-provider-availability.ts`** — unchanged behaviourally; `GET /scheduling/availability` now returns the live generation, which is what the calendar's hour bounds already assumed.

## Tests required

### Success

- `PUT /scheduling/schedule` with multiple blocks on one day writes exactly those rows for the live generation and returns them (integration).
- `PUT` with `effective_from` and no collisions creates a pending generation, leaves the live rows untouched, and returns `pending` populated (integration).
- `GET /scheduling/schedule` returns `current`, `pending`, `timezone`, and a provider-local `today` (integration).
- `get_open_slots` returns **current** hours for dates before `effective_from` and **pending** hours on and after it, across a single query range spanning the boundary (unit).
- `DELETE /scheduling/schedule/pending` returns 204 and leaves live hours intact (integration).
- Writing again normalizes: superseded generations are deleted and the live one collapses to `effective_from = NULL` (integration).
- `GET /scheduling/availability` returns only the live generation while a pending one exists (integration).
- `/settings` renders provider nav for a provider and patient nav for a patient, with Settings marked `aria-current="page"` and the URL unchanged (component).
- Provider nav's first link reads "Dashboard" and points at `/provider/calendar`; settings "Back to dashboard" points at the same place (component).
- Working-hours form renders multiple blocks per day, adds a block defaulting to one hour after the previous end, and removes one (component).
- Choosing "Apply from" in the modal issues a `PUT` with the chosen `effective_from` and then renders the pending banner (component).
- End-to-end: provider sets multi-block hours → patient sees slots matching those blocks → provider defers a change → slots before the date use old hours, slots on/after use new (end-to-end, extending `bookings/tests/test_acceptance_journey.py`).

### Failure

- Overlapping blocks on one day → 400 with `windows` keyed by that day index (integration) and blocked client-side with the wireframe message before any request (unit + component).
- Blocks less than one hour apart, including exactly touching (`12:00`/`12:00`) → 400 / client error (unit + integration).
- `end_time <= start_time` → 400 / client error (unit + integration).
- `effective_from` today or in the past → 400 on `effective_from` (integration).
- `effective_from` earlier than `earliest_safe_date` → 409 with collisions, nothing written (integration).
- Immediate `PUT` that would strand a booking → 409 with collisions and `earliest_safe_date`, **no rows changed** (integration).
- Patient calling `GET`/`PUT /scheduling/schedule` or `DELETE .../pending` → 403; unauthenticated → 401 (integration).
- Provider A cannot read or write provider B's schedule; a body-supplied `provider` is ignored (integration).
- `DELETE /scheduling/schedule/pending` with no pending change → 404 (integration).
- `useCurrentUser` returning `null` (role fetch failed) on `/settings` → patient nav, never a blank or provider header (component).

### Edge cases

- Role still loading on `/settings`: header present, `aria-busy`, no `<nav>`, no portal label, no role links (component).
- Second pending change rejected or replacing the first — one pending at a time (integration).
- Editing the **live** hours while a pending change exists: collisions are evaluated per booking against whichever generation covers its date (unit on `find_schedule_collisions`, integration on `PUT`).
- Deferral that cannot clear all collisions → 409 with `earliest_safe_date: null`; modal shows cancel-only (integration + component).
- Effective date crossing a DST transition: wall-clock windows still resolve correctly on both sides (unit on `get_open_slots`).
- Provider in a non-UTC timezone where "today" differs from UTC's today: `effective_from` validation uses clinic time (unit).
- `windows: []` — provider clears all hours; `SlotsView` still reports `bookable: false` sensibly (integration).
- A pending change whose date has passed but no write has happened since: reads treat it as live (unit + integration).
- Last block removed from a day equals unchecking that day (component).
- Booking exactly on the effective-date boundary at local midnight (unit).

## Risks and open questions

- **No new scheduler — deliberately.** The switch is computed at read time from `effective_from`, so nothing needs to flip rows at midnight. The cost: between the effective date and the provider's next save, superseded rows linger in the table and `current.effective_from` is a past date rather than `NULL`. Normalization on write bounds this; the alternative (a nightly job) would be a new scheduler dependency this project doesn't have.
- **No new database and no new third-party dependency.** One nullable column on an existing table, one new index, existing DRF/Django only.
- **The ≥1 hour separation and no-overlap rules cannot be DB constraints.** They're cross-row and application-enforced. A direct ORM write (`seed_demo`, a shell, a future endpoint) can create data that violates them. All current seed windows satisfy the rule (the widest violation risk was the lunch splits, which are exactly one hour), but existing production rows are not re-validated by the migration.
- **Cancelling a pending change is unguarded.** Per the locked story it's a simple confirm. If a patient booked into a slot that only exists under the pending hours, discarding it leaves that booking outside the restored live hours. Recommendation, matching TICKET-11's principle: never auto-cancel, and write one `BOOKING_FLAGGED_AS_EXCEPTION_ACTION` audit entry per affected booking. **Confirm this is the wanted behaviour, or ask for a 409-with-collisions on cancel instead.**
- **The 90-day collision horizon still applies.** A booking past `DEFAULT_HORIZON_DAYS` is neither reported nor factored into `earliest_safe_date`, so a "safe" date can still strand a very distant booking. Pre-existing limitation, now inherited by the deferral date.
- **Retiring three endpoints has test fallout.** `backend/scheduling/tests/test_availability_api.py` (create/delete cases), `test_availability_collision_api.py`, and `bookings/tests/test_acceptance_journey.py` (line ~130) must migrate to `PUT /scheduling/schedule`. **Confirm the retirement rather than leaving them as a second, unguarded write path.**
- **`GET /scheduling/availability` changes meaning.** Same shape, plus `effective_from`, but scoped to the live generation. The provider calendar's hour bounds will not widen to accommodate a pending schedule when viewing a future week — acceptable for this scope, worth naming.
- **Audit action names** (`update:availability_schedule`, `schedule:availability_change`, `cancel:availability_pending_change`) follow the `create:blocked_time` convention but are new strings. Confirm before anyone builds a log filter on them.
- **Last write wins.** Two tabs saving the schedule will silently overwrite each other; whole-generation replace makes this coarser than the old per-day writes. No optimistic-concurrency token proposed. Flagging, not solving.
- **Story 1 could avoid the loading state entirely** with a server-component `app/settings/layout.tsx` fetching `/auth/me` with the request cookie, the way `proxy.ts` already does. The story locked a neutral client-side loading state, so this brief specifies that; the server-side variant is available if you'd rather trade one extra server fetch for zero flash.
- **Repo conventions:** the root has no `CLAUDE.md`; `frontend/CLAUDE.md` only includes `frontend/AGENTS.md`, whose sole rule is to read `node_modules/next/dist/docs/` before writing Next.js code — relevant to the new `app/settings/layout.tsx` and to making `AppShell` a client component. No conflicts with anything above.

## Files that will change

**Backend**

- `backend/scheduling/models.py` — add `effective_from`, index, `Meta.ordering` with `nulls_first`.
- `backend/scheduling/migrations/0004_availability_effective_from.py` — **(new)** AddField + AddIndex + AlterModelOptions.
- `backend/scheduling/schedule.py` — **(new)** generation selection, weekly-window validation (overlap / ≥1h gap / end>start), `provider_today`, `earliest_safe_date`, transactional `replace_generation`.
- `backend/scheduling/slots.py` — `get_open_slots` picks the generation effective on each local date.
- `backend/scheduling/collisions.py` — add `find_schedule_collisions(provider, generations)`; `find_availability_collisions` becomes its single-generation helper.
- `backend/scheduling/serializers.py` — `AvailabilitySerializer` gains `effective_from`; add `ScheduleWindowSerializer`, `ProviderScheduleSerializer`, `ScheduleWriteSerializer`, `ScheduleConflictSerializer`; remove the two collision-check serializers.
- `backend/scheduling/views.py` — add `ProviderScheduleView` and `PendingScheduleView`; narrow `AvailabilityListCreateView` to `GET` only; remove `AvailabilityDetailView` and `AvailabilityCollisionCheckView`.
- `backend/scheduling/urls.py` — add `scheduling/schedule` and `scheduling/schedule/pending`; remove three retired routes.
- `backend/scheduling/admin.py` — add `effective_from` to `AvailabilityAdmin.list_display`/`list_filter`.
- `backend/scheduling/tests/test_availability_api.py`, `test_availability_collision_api.py`, `test_slots.py`, `test_collisions.py`, `test_models.py`, `test_admin.py` — migrate and extend per the test list.
- `backend/scheduling/tests/test_schedule_api.py` — **(new)** the `GET`/`PUT`/`DELETE /scheduling/schedule` suite.
- `backend/bookings/tests/test_acceptance_journey.py` — replace the five per-day `POST`s with one `PUT /scheduling/schedule`.

**Frontend**

- `frontend/app/settings/layout.tsx` — **(new)** renders `SettingsShell`.
- `frontend/components/nav/SettingsShell.tsx` — **(new)** role resolution + patient fallback.
- `frontend/components/nav/AppShell.tsx` — `"use client"`, `role: Role | null`, neutral loading header, `aria-current="page"`.
- `frontend/components/nav/AppShell.test.tsx` — mock `usePathname`; add loading-state, current-page, and "Dashboard" label cases.
- `frontend/lib/nav-config.ts` — provider label rename + comment update.
- `frontend/app/settings/page.tsx` — `ROLE_HOME.provider` → `/provider/calendar`.
- `frontend/lib/availability/types.ts` — schedule/generation/conflict types, `effective_from` on `AvailabilityDay`.
- `frontend/lib/availability/validation.ts` + `validation.test.ts` — per-day multi-block validation.
- `frontend/components/availability/WorkingHoursSection.tsx` — multi-block editing, `GET`/`PUT /scheduling/schedule`, pending banner wiring.
- `frontend/components/availability/WorkingHoursSection.test.tsx` — **(new if absent)** the component cases listed above.
- `frontend/components/availability/PendingScheduleBanner.tsx` + `.test.tsx` — **(new)**.
- `frontend/components/availability/CollisionWarningModal.tsx` — optional `deferral` prop with the date picker; blocked-time path unchanged.
- `frontend/components/UIRedesign.acceptance.test.tsx` — update any assertion on the provider "Calendar" label.