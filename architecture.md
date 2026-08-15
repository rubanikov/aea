# Architecture — Patient Appointment & Scheduling Portal

Decision date: 2026-08-10. This document turns the findings in `tech-stack-research.md` (candidate stack comparison) and `prior-art-research.md` (how five real booking/scheduling systems actually solve this problem) into a concrete build plan. Every non-obvious decision below is tied back to a specific finding in one of those two documents rather than asserted from scratch — see them for full sourcing and citations.

**Reading this after the build:** §1–§9 are the pre-build design, kept as written so the reasoning stays traceable, with **"As built"** notes wherever the shipped code differs. §10 lists the mechanisms that were added during and after the build and are not covered by the original sections. For the endpoint-level view see [`docs/api.md`](docs/api.md).

---

## 1. Stack

| Layer | Choice | Why (from `tech-stack-research.md`) |
|---|---|---|
| Backend | **Django** | `select_for_update(nowait=, skip_locked=)` is a first-class, typed API for the row-lock guard — directly usable for §3 below. Avoid Node+Prisma: no native `FOR UPDATE` support (unresolved upstream issue), disqualifying for a 20-point pass/fail concurrency gate. |
| Database | **Postgres** (Supabase-compatible connection string, plain `DATABASE_URL` in this build — see §6) | `select_for_update()` needs real row locks; SQLite is a silent no-op there. Auth is a custom JWT-cookie system rather than Supabase Auth, which took RLS off the table — see §6 for the full reasoning and what still enforces row-ownership instead. |
| Backend hosting | **Railway** | Render's free tier explicitly forbids background worker/cron service types — a hard blocker for the reminder job (§7). |
| Frontend hosting | **Vercel** (planned) → **Railway** (as built) | Vercel was chosen for its first-party Next.js integration and self-serve BAA path. As built, the frontend is a second Railway service in the same project: `*.up.railway.app` is a public suffix, so frontend and backend on separate Railway domains are different *sites* and `SameSite=Strict` auth cookies would never be sent cross-site. The frontend therefore rewrites API paths to the backend's origin (`frontend/next.config.ts`, `lib/api/proxy-rewrites.ts`) so cookies stay first-party. Vercel would still work with the same rewrite target configured — see `docs/deployment.md`. |
| Email | **Resend** | Only real free-tier option; reminder bodies stay PHI-free by design (no BAA available). Cancellation notices are a scoped, deliberate exception to that — see §7. |
| AI (optional stretch) | **Groq** | Free, documented rate limits, has an (excludes-free-tier) BAA program. Only needed if building the NL-booking stretch feature. |

---

## 2. Data model: compute slots, don't store them

Every system in `prior-art-research.md` that got this right — Cal.com, Medplum, Easy!Appointments — does the same thing despite three unrelated stacks: **a bookable slot is never a persisted row.** You store the inputs and compute availability at query time.

**Appointment duration is not a fixed constant — it's configurable per visit type.** Real-world scheduling standards vary widely: follow-ups commonly run 10–15 minutes, new-patient visits 20–45 minutes, and complex/physical exams up to 45–60 minutes, scheduled against a base grid increment (commonly 10 or 15 minutes) rather than one uniform slot length ([Incredible Health, nurse-sourced scheduling norms](https://www.incrediblehealth.com/nurse-advice/questions/4e88f69e/how-long-are-appointment-time-slots-and-how-many); [Houston Family Physicians, average visit duration](https://www.houstonfamilydoctors.com/average-primary-care-clinic-appointment-duration/)). This matches what Easy!Appointments already does in practice — its slot-generation code checks the remaining free time against "the **service's** duration," not a single global slot length (see `prior-art-research.md` §4). So duration belongs on a per-appointment-type record, not on `Availability`.

> **As built:** duration is per-`AppointmentType`, but the allowed values are a closed set — **exactly 30 or 60 minutes** — enforced by a DB `CheckConstraint` (`appointment_type_duration_in_30_60`, `scheduling/models.py`) and by the serializer. This was a product decision taken during the build (a two-choice slot length keeps the calendar grid, the k6 slot arithmetic, and the collision rules simple); the 10–15 / 20–45 minute clinical examples above describe the general case the model *could* be widened to, not what the app accepts today.

Core tables:
- **`AppointmentType`** (a.k.a. Service) — `provider_id`, `name` (unique per provider), `duration_minutes` (30 or 60, see above). A provider defines one or more of these; each booking is for a specific `AppointmentType`, and that type's duration is what actually sizes the slot at booking time. Changing a type's duration is refused with a 409 (listing the affected bookings) while future active bookings of that type exist.
- **`Availability`** — provider's recurring working hours, one row per contiguous **block** (`day_of_week`, `start_time`, `end_time` as naive wall-clock in `provider.timezone`). *As built, "optional date-specific overrides" became something more structured:* a provider's rows are partitioned into **generations** by `effective_from` — `NULL` is the live schedule, and at most one future date holds a *pending* schedule that takes over on that date (`scheduling/schedule.py`). Which generation governs a calendar day is computed at read time; nothing promotes rows. A weekday may hold several blocks, which must not overlap and must be ≥1 hour apart. Modeled on Cal.com's `Schedule`/`Availability` and Medplum's `SchedulingParameters` — *not* OpenEMR's approach (working hours as an ordinary recurring calendar event in a special category — a legacy artifact of forking a 2001 CMS calendar module, not a pattern worth repeating).
- **`BlockedTime`** — one-off provider unavailability (vacation, admin block): `start`/`end` UTC instants, optional `label`.
- **`Booking`** — the actual appointment: `provider_id`, `patient_id`, `appointment_type_id`, `start_time` (UTC), `end_time` (UTC, derived from `appointment_type.duration_minutes` at booking time), `status`, plus the constraints from §3. *As built also:* `idempotency_key` (optional, unique; from the `Idempotency-Key` header so a retried `POST /bookings` returns the original booking instead of a 409) and `cancellation_reason` (provider-written free text, required when a provider cancels; see §7a).
- **`ReminderLog`** — append-only send record, see §7. **`CancellationNotificationLog`** (as built) — one row per cancellation email/SMS attempt, used for the per-recipient hourly budget in §7a.
- **`AuditLog`** — append-only, `actor / action / target_type / target_id / timestamp / metadata`, see §6.
- **`RefreshTokenRotation`** (as built, `accounts/models.py`) — receipt table behind refresh-token rotation and replay detection, see §10.

Open slots = `Availability (governing generation) − (BlockedTime ∪ existing active Bookings)`, discretized using the **selected `AppointmentType`'s duration**, computed fresh on every read (`scheduling/slots.py`; a query spans at most 60 days; a patient's own active bookings with *any* provider are also subtracted so they can't double-book themselves). This also directly satisfies edge case #3 in the brief (provider shrinks availability without silently deleting a booked slot): because `Booking` is its own table, editing `Availability` never touches existing bookings — you're only changing what's bookable *going forward*. A provider-availability edit that would collide with an existing confirmed `Booking` is flagged rather than silently applied — *as built*, `scheduling/collisions.py` scans active bookings up to 133 days ahead for schedule changes and blocked-time additions and returns a 409 listing the collisions (plus the `earliest_safe_date` a pending schedule could start on instead); the provider then either picks another date, or explicitly keeps the change and the affected bookings are marked as exceptions in the audit log (`availability_change:booking_flagged_as_exception`) — never auto-cancelled. None of the five systems studied has such a check (OpenEMR and Easy!Appointments have none at all).

---

## 3. Double-booking guard: combine Medplum's and Cal.com's mechanisms

This is the brief's pass/fail requirement (20/100 points), so don't pick one prior-art approach — stack both, since together they cover each other's gap. This is the single highest-value synthesis point from the research: no individual system studied combines both.

**Layer 1 — Medplum's mechanism (the strongest found).** Wrap booking creation in a transaction, re-validate availability *inside* the transaction immediately before insert, and use Postgres's strongest isolation guarantee so two concurrent transactions physically cannot both see the slot as free:
```python
with transaction.atomic():
    conflicting = Booking.objects.select_for_update().filter(
        provider_id=provider_id, status__in=["requested", "confirmed"],
        start_time__lt=requested_end, end_time__gt=requested_start,
    )
    if conflicting.exists():
        raise SlotNoLongerAvailable()
    Booking.objects.create(...)
```
`select_for_update()` takes a row lock on any existing overlapping bookings for that provider, serializing concurrent attempts on the same window. (If overlap patterns get complex, Medplum's alternative — `SERIALIZABLE` isolation with retry-on-conflict via Django's `transaction.atomic(durable=True)` + catching `OperationalError` — is the fallback; start with `select_for_update`, it's simpler and Django-idiomatic.)

> **As built** (`bookings/services.py::_book_open_slot`): one locking query covers both axes — `filter(Q(provider=provider) | Q(patient=patient), status__in=ACTIVE, start_time__lt=end, end_time__gt=start).select_for_update()` — and the slot is re-validated against the provider's current hours and blocked time inside the same transaction before the insert. The row is created as `requested` and moved to `confirmed` by `transition()` in the same transaction (§4).

**Layer 2 — Cal.com's mechanism, as an unconditional backstop.** A DB `UNIQUE` constraint on the `Booking` table itself:
```python
class Meta:
    constraints = [
        models.UniqueConstraint(
            fields=["provider_id", "start_time"],
            condition=Q(status__in=["requested", "confirmed"]),
            name="unique_active_booking_per_provider_slot",
        )
    ]
```
The same two layers apply on the **patient** axis: Layer 1's `select_for_update` also locks overlapping active bookings for `patient_id`, and Layer 2 adds `unique_active_booking_per_patient_slot` on `(patient, start_time)` for `requested`/`confirmed`. A patient cannot hold two chairs at the same time, even across different providers.

Cal.com's own docs note their equivalent key only catches *identical* start/end, not general overlap. That was acceptable while every appointment was a 60-minute hour block (identical `start_time` ⇔ same hour). **As built it is no longer sufficient**, because appointment types are 30 *or* 60 minutes (§2): a 60-minute booking at 09:00 and a 30-minute one at 09:30 overlap without sharing a `start_time`, and two such inserts racing have nothing committed yet for Layer 1 to lock. So `Booking.Meta` (`bookings/models.py`, migration `0005_no_overlapping_active_bookings`) carries **four** DB constraints:

- the two partial `UniqueConstraint`s above (exact-start case, per provider and per patient), kept as cheap self-documenting guards; and
- two Postgres **`ExclusionConstraint`s** (`btree_gist`, `TSTZRANGE(start_time, end_time) &&` with `provider =` / `patient =`, same `status IN ('requested','confirmed')` condition) — `no_overlapping_active_booking_per_provider` and `..._per_patient` — which make Postgres itself refuse the second overlapping active insert whatever the two spans' shapes.

Two consequences of the exclusion constraints are handled explicitly in `bookings/services.py`: a violation is mapped to `409 SlotNoLongerAvailable` (or `PatientAlreadyBooked` when the patient-axis constraint is the one that fired), and a Postgres **deadlock abort** (SQLSTATE `40P01`, a designed-in outcome of GiST exclusion checks running after the tuple insert when two overlapping inserts race) is treated as the same lost race → 409, not a 503. Any other `OperationalError` is re-raised.

Even if a future refactor introduces a bug in the transaction logic above, the database itself cannot commit two overlapping active bookings for the same provider or the same patient. This is strictly more robust than either system alone, and it's exactly the "row lock + unique constraint" combination the brief specifies.

**Idempotency (as built).** `POST /bookings` accepts an optional `Idempotency-Key` header (≤255 chars) stored on `Booking.idempotency_key` (globally unique). A replay with the same key *by the same patient* returns the original booking (200-equivalent path, no second insert, checked before any conflict logic and again if the insert races); the same key from a *different* patient is refused with `409 IdempotencyKeyConflict` and never reveals the other patient's row. This is what makes the frontend's double-submit-safe button actually safe under retries, rather than merely disabled.

**Reschedule (as built).** `PATCH /bookings/<id>/reschedule` (`bookings/services.py::reschedule_booking`) re-fetches the booking under `select_for_update`, enforces the 24-hour notice rule against the *original* start time, cancels the old booking, and books the new slot through the same `_book_open_slot` guard — all in one transaction, so a failed rebook leaves the original booking untouched.

**Explicitly do not ship:** a pre-check-then-insert with no DB guard — the pattern Easy!Appointments' own code comment admits is a race ("it is possible that two or more customers select the same appointment date and time concurrently... one of the two will eventually get the selected date") and that OpenEMR has zero protection against at all (confirmed against its live schema — no unique constraint, no transaction, no lock on the insert path). These are the "what not to do" reference points from the research, not design options.

Write the automated concurrent test (N simultaneous requests on the last open slot, assert exactly 1 success) directly against this guard — per Django's own behavior, `select_for_update()` is a silent no-op on SQLite, so this test **must** run against real Postgres, never the local SQLite default, or it will falsely pass.

---

## 4. Status lifecycle: closed enum + explicit transition guard

Use a Django `TextChoices` enum — not a free-text field. Easy!Appointments made `status` an admin-editable `VARCHAR(512)` with zero transition guards anywhere in the code, meaning nothing stops `Cancelled → Confirmed`; that's the anti-pattern.

```python
class AppointmentStatus(models.TextChoices):
    REQUESTED = "requested"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"

ALLOWED_TRANSITIONS = {
    AppointmentStatus.REQUESTED: {AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED},
    AppointmentStatus.CONFIRMED: {AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW},
    AppointmentStatus.COMPLETED: set(),
    AppointmentStatus.CANCELLED: set(),
    AppointmentStatus.NO_SHOW: set(),
}

def transition(booking, new_status, actor):
    if new_status not in ALLOWED_TRANSITIONS[booking.status]:
        raise InvalidTransition(booking.status, new_status)
    ...
    AuditLog.objects.create(actor=actor, action=f"status:{booking.status}->{new_status}", target=booking.id)
```
Modeled on Cal.com's `confirm.handler.ts` (guards re-entrancy — throws if a booking is already `ACCEPTED`) and OpenEMR's terminal-state checks (once a status is terminal, e.g. "coding done," nothing moves it further). One function is the single write path for every status change, which is also where the audit log entry gets written (§6) and where the brief's `no_show`-only-from-`confirmed`-past-start-time rule gets enforced.

> **As built** (`bookings/transitions.py`): the table above is implemented verbatim. `transition()` additionally enforces two timing rules the design left implicit — `NoShowBeforeStartTime` (a `-> no_show` before `start_time` has passed is a 400) and a **24-hour minimum cancellation notice** (`CANCELLATION_MIN_NOTICE`; any `-> cancelled` less than 24 h before `start_time` is a 400 `CancellationNoticeTooShort`, regardless of whether the patient, provider or admin is cancelling). The single sanctioned bypass is account deletion (`enforce_notice=False`, see `backend/docs/retention-policy.md`). A provider's cancellation must carry a written `cancellation_reason` (≤500 chars), saved in the same `save()` as the status; a patient's self-cancel carries none. The status write and its audit row are one atomic unit.

**Business rule: patient-initiated bookings are auto-accepted.** The brief's own acceptance criteria mandate the literal sequence "requested → confirmed" (Core requirement #6), so the status is not skipped — but nothing waits on manual provider approval. `POST /bookings` (§3) creates the row as `REQUESTED` and, inside the *same* request/transaction, immediately calls `transition(booking, CONFIRMED, actor=system)`. The patient's observable experience is a single "your appointment is confirmed" response, not a pending state. This inverts the provider's role in the lifecycle: instead of a pre-emptive confirm/decline gate, the provider's lever is post-hoc — `CONFIRMED → CANCELLED` after the fact, if they need to cancel a booking that already went through. `REQUESTED` still exists as a real, observable transient state (satisfies the brief's transition test and leaves room for a future "requires manual approval" appointment type if ever needed), but the default and only currently-built path resolves it synchronously.

---

## 5. Time zones: UTC + separate per-actor zone, DST-tested

Store every timestamp in UTC (`DateTimeField` with `USE_TZ=True`). Store the provider's and patient's IANA timezone (`America/Chicago`, etc.) as separate fields — never fold a timezone conversion into a naive local string. This is the one thing every system in the research that handles multi-timezone correctly does (Cal.com: independent `timeZone` on Schedule *and* each Attendee row; Medplum: preserves submitted offset exactly, throws if a scheduled actor has no timezone extension), and the one thing both systems that got it wrong share (OpenEMR: one global process-wide timezone, naive `date`/`time` columns, no per-row offset at all; Easy!Appointments: the customer-facing timezone selector is display-only JS — `moment.tz(...)` re-renders the label, but the actual submitted `start_datetime` is built from the original provider-local string, so the "conversion" never reaches storage — a real, shipped bug worth explicitly not repeating).

Python's `zoneinfo` (stdlib, IANA-backed) handles DST arithmetic correctly by construction — same category as Medplum's `Temporal` and Cal.com's `dayjs`-with-explicit-offset-correction. But write an explicit test that generates slots across a DST transition week regardless: Cal.com needed dedicated, commented code (`processWorkingHours()` — computing the UTC offset at start-of-day vs. at the actual working-hours start time and correcting for the 60-minute difference) to get this right even with a DST-aware library underneath. A DST-aware library prevents *arithmetic* bugs, not *logic* bugs in how you apply it.

> **As built:** there is one `accounts.User.timezone` field (IANA name, validated against `zoneinfo.available_timezones()`, default `UTC`) used for whichever role the user has — the provider's value governs how their wall-clock `Availability` blocks and calendar-day queries are interpreted, the patient's value governs how times are rendered to them (and in their cancellation notices). `Availability.start_time`/`end_time` are stored as naive wall-clock times and converted per calendar day in `scheduling/slots.py`, so a 09:00 block stays 09:00 local across a DST change; `BlockedTime` and `Booking` are absolute UTC instants. `scheduling/tests` includes the DST-week slot test the paragraph above asks for.

---

## 6. RBAC / PHI: DB-enforced row-level policy + app-level check, both layers

Every mature system in the research pairs a role→permission grant with an independent row-level ownership filter — Medplum's `AccessPolicy` + FHIR compartment (`%patient`), Cal.com's PBAC `Role`/`RolePermission` plus org `Membership`, Easy!Appointments' bitmask role matrix plus its separate `has_customer_access()` row-level check. OpenEMR is the counter-example: role grants only (phpGACL), no row-level layer found — a real gap, not a design worth copying.

Concretely:
- **DB layer:** planned as Supabase RLS policies keyed on `auth.uid()` — `patient_id = auth.uid()` on `Booking` reads for the patient role, `provider_id = auth.uid()` for the provider role, admin bypasses via a separate policy scoped and logged. **Not implemented in the actual build, by deliberate decision, not oversight:** `auth.uid()`-keyed RLS assumes Supabase Auth is the identity provider populating that session variable. TICKET-02 instead built a custom `accounts.User` model with JWT-in-httpOnly-cookie auth (architecture.md's own design, chosen for the cross-origin Vercel/Railway split — see tech-stack-research.md), so there is no `auth.uid()` for an RLS policy to key on without also adopting Supabase Auth specifically, which was never in scope. Writing RLS policies against a *different* identity mechanism (e.g. a custom Postgres session variable set per-request from the JWT) is possible but would be a parallel, independently-maintained authorization system alongside the app-layer checks below — exactly the "two guards that can drift apart" pattern this document argues against elsewhere (see §3's double-booking guard reasoning). The brief's own requirement is explicitly "Postgres RLS **or** explicit server-side checks" (project.md, Security section) — the app-layer half alone satisfies that bar on its own merits, verified by `audit/tests/test_permissions.py` and every ownership test across `scheduling`/`bookings`. If a future pass adopts Supabase Auth as the actual identity provider, RLS becomes straightforward to add as true defense-in-depth on top of the existing app-layer checks, not a replacement for them.
- **App layer:** every service method that touches a `Booking`, `Availability`, or PHI field re-checks ownership explicitly, rather than trusting RLS alone. This is the layer actually enforcing row-level ownership in the shipped build (see above) — `audit.permissions.IsOwnerOrAdmin` / `bookings.permissions.IsBookingProviderOrAdmin`, both audit-logging every admin bypass.
- **Audit log:** modeled on Medplum's approach (an `AuditLog` write generated automatically at the data-access layer on every PHI read/write and every status transition — not a documented developer responsibility bolted on later) and OpenEMR's tamper-evidence idea (a `checksum` field per row) if time allows. Every entry: `actor, action, target, timestamp`, append-only. *As built:* the per-row checksum was not added; append-only is instead enforced twice — `AuditLog.save()`/`delete()` and the queryset's `update()`/`delete()` raise `AuditLogIsAppendOnly` (`audit/models.py`), and a Postgres trigger (`audit/migrations/0002_append_only_trigger.py`) rejects raw-SQL `UPDATE`/`DELETE` too — which is a stronger guarantee than a checksum (which only *detects* tampering after the fact). All writes go through `audit.services.record_audit_event`, synchronously inside the caller's transaction, so a domain write and its audit row commit or roll back together. Admin bypasses are logged as `admin_bypass:<action>:<target_type>`; the admin's own reads of the audit log are logged as `read:audit_log`. `metadata` is IDs/roles/status only — never names or free text (the provider's cancellation reason lives on the `Booking` row, not in the audit log).
- **Auth transport (as built, `accounts/`):** JWT (SimpleJWT) delivered as two httpOnly, `Secure` (outside debug), `SameSite=Strict` cookies — `access_token` (15 min, path `/`) and `refresh_token` (7 days, path `/auth`). `POST /auth/refresh` rotates the refresh token; a rotated-out token replayed inside a 10 s grace window gets the already-issued pair (multi-tab race), outside it is treated as **reuse** and every outstanding refresh token for the account is revoked (`accounts/tokens.py`, `RefreshTokenRotation`). CSRF: DRF views are exempt from Django's CSRF machinery, so `CookieJWTAuthentication` requires `X-Requested-With: XMLHttpRequest` on every unsafe-method request (`accounts/csrf.py`) — a header a cross-site form post cannot set. Login is throttled 5/min per IP and locked out after 10 failures / 15 min per account (`accounts/lockout.py`, cache-backed, email fingerprinted with SHA-256 so no PHI in cache keys or logs). Passwords are bcrypt. Provider and admin accounts are not self-service: `POST /auth/register` always creates a patient.
- **No PHI in logs:** application/server logs reference booking/patient IDs, never names or contact details — matches the brief directly and the pattern CallSphere's blog post (in `prior-art-research.md` §6) independently arrived at (`SafeLogger` hashes patient IDs before logging). Outside debug every log line is one JSON object (`core/logging.py`).

---

## 7. Reminders: the weakest link everywhere in prior art — be the exception

No system studied has a good reference implementation here. Medplum ships no reminder feature at all (Bots/Subscriptions are generic primitives). Cal.com had a full reminder engine but it was Enterprise-only and is now deleted from the actively-developed fork, leaving only a narrow "nag the organizer about unconfirmed bookings" cron. Easy!Appointments never had a scheduled reminder job — only immediate transactional email plus a calendar-client-side `.ics` alarm. The one usable idea is OpenEMR's — despite being the oldest codebase studied, it's the only one with a real, working, cron-driven reminder dispatcher: a persisted "already sent" marker checked in the same query that selects candidates.

Improve on OpenEMR's version with what none of the five systems did: back the dedup with a real DB constraint, not just an application-level check-then-write (the same *class* of race as double-booking, just lower stakes if it fails).
```python
class ReminderLog(models.Model):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE)
    interval = models.CharField(...)  # e.g. "24h"
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["booking", "interval"], name="unique_reminder_per_booking_interval")
        ]
```
A Railway cron job runs every 15–30 min: select confirmed bookings due for a reminder, left-join against `ReminderLog` to exclude already-sent, send via Resend, insert the log row. If the insert violates the unique constraint (a concurrent/retried run), catch and skip — the constraint is the actual guarantee, the query filter is just an optimization to avoid redundant sends in the common case.

### 7a. Outbound content: PHI-free, with one approved exception

The **reminder** path above is PHI-free and stays that way: its bodies carry an appointment time and a link into the authenticated portal, nothing about who the patient is, who the provider is, or what the appointment is for. That is what §1's "reminder bodies stay PHI-free by design (no BAA available)" means, and this feature did not change it.

The **cancellation-notification** path (`bookings/notifications.py`, the doctor-cancellation feature) is a deliberate, approved exception to that blanket claim, and the claim is scoped accordingly — it no longer covers every outbound message, only the reminder path.

What that path sends, over transports with no BAA behind either of them:

- **Content:** the appointment's date and time rendered in the patient's own timezone, plus **the provider's free-text cancellation reason** — written by a clinician, in a clinical context, about a specific patient's appointment. It is not sanitised and cannot be: the whole value of the message is that it says *why*. It deliberately still omits the patient's name, the provider's name, and the appointment type, so the payload is minimal — but "minimal" is not "PHI-free," and calling it PHI-free would be false.
- **Transports:** Resend (email), same as the reminder path; and, when the patient has supplied a phone number and carrier, the carrier's **email-to-SMS gateway** — which means the same message is handed to a third party (the mobile carrier) and delivered as an unencrypted SMS. No BAA covers either hop.

**Why this was accepted, explicitly.** It was weighed as a product decision, not missed: a patient whose appointment vanishes with no explanation calls the clinic, rebooks blind, or simply shows up. Telling them *why*, on the channels they actually read, is the entire point of the feature, and a reason-free "your appointment was cancelled" notice was judged to fail the patient in exchange for a posture claim. The mitigations are the minimal payload above, the fact that the notification never carries anything beyond the reason and the time, and that everything else stays behind portal login. The patient opts into the SMS half themselves by saving a phone number and carrier in their profile; the email half follows the account they already registered.

**Abuse controls on this path (as built):** the provider status endpoint is throttled to 10 cancellations/min per account (`booking_cancel` scope); each recipient gets at most 5 cancellation notifications per hour (`CancellationNotificationLog`, `RECIPIENT_HOURLY_NOTIFICATION_BUDGET`) so a misbehaving provider cannot flood a patient's phone; SMS bodies are capped at 160 GSM-7 characters with the reason truncated first. Notification runs strictly *after* the cancellation has committed and never raises — a failed send is reported in the response's `notification` object, never turned into a 500. Only the provider/admin cancel path notifies; a patient's own self-cancel sends nothing.

If a BAA-covered transport ever comes into scope, this is the path to move first.

---

## 8. Explicit anti-patterns (confirmed present in real, shipped systems — don't repeat them)

| Anti-pattern | Where it was found | What to do instead |
|---|---|---|
| Pre-check-then-insert with no DB guard on booking creation | Easy!Appointments (admitted in its own code comment), OpenEMR (no guard at all) | §3 — transaction + row lock + unique constraint |
| Free-text status field, no transition guards | Easy!Appointments | §4 — closed enum + explicit transition table |
| Naive local timestamps / display-only timezone conversion that never reaches storage | OpenEMR (single global tz), Easy!Appointments (client-side-only conversion) | §5 — UTC + separate per-actor IANA zone, stored |
| Role grants with no row-level ownership check | OpenEMR (phpGACL only) | §6 — role check + explicit app-level ownership check on every PHI-touching view (Supabase RLS was planned as a second layer and deliberately dropped, see §6) |
| Building a heavyweight, Enterprise-style workflow/automation engine for reminders | Cal.com's now-deleted Workflows engine — over-built relative to what shipped long-term | §7 — one cron job, one dedup table, keep it simple |

---

## 9. Open items to resolve during build

- Working-hours UI for provider availability setup — resolved by the UX wireframe pass (`wireframes.html`); the same pass extended Screen 5 to cover per-`AppointmentType` duration configuration (§2) alongside weekly hours. *As built this grew well past the wireframe:* multiple blocks per weekday, a deferred "pending schedule" with an `effective_from` date, a collision scan with an `earliest_safe_date` suggestion, and a discard endpoint — see §2 and §10.
- Whether the stretch waitlist feature (brief item #8) is in scope for this pass — if yes, it needs its own concurrency guard on "next waitlisted patient gets the freed slot," which none of the five systems studied implement in a way worth copying. **Not built.**
- Recurring-appointment stretch feature (#10) is out of scope for the architecture above; would need its own design pass if pursued. **Not built** (the seed's "weekly-recurring cohort" is 100 ordinary individual bookings, not a recurrence feature).
- **Resolved, not open:** the two items above (§2 duration model, §4 auto-accept) were open questions the user resolved directly — durations are per-`AppointmentType` (30 or 60), not one global constant, and patient bookings auto-confirm rather than waiting on manual provider approval.

---

## 10. As built: mechanisms added during and after the build

Everything below exists in the code and is tested; none of it was in the 2026-08-10 design. Endpoint detail is in [`docs/api.md`](docs/api.md); user-facing behaviour in [`docs/features.md`](docs/features.md).

| Area | What was added | Where |
|---|---|---|
| Availability generations | Multi-block weekly hours (≥1 h gap between same-day blocks, no overlaps); one optional *pending* generation keyed by a future `effective_from`, selected at read time per calendar day; `GET/PUT /scheduling/schedule` returns `{current, pending}`; `DELETE /scheduling/schedule/pending` discards it and flags now-orphaned bookings as exceptions instead of cancelling them. | `scheduling/schedule.py`, `scheduling/services.py` |
| Collision scan | Schedule changes and new blocked time are diffed against active bookings up to 133 days out; a hit is a 409 listing them (`patient_name`, `appointment_type_name`, times) with `earliest_safe_date`; the provider may explicitly `keep_new_hours` (bookings flagged in the audit log) or `cancel_change`. Duration changes on an appointment type with future bookings are refused outright. | `scheduling/collisions.py`, `scheduling/views.py` |
| Overlap exclusion constraints | GiST `ExclusionConstraint`s per provider and per patient on active bookings; deadlock abort → 409. | `bookings/models.py`, migration `0005` |
| Idempotent booking creation | `Idempotency-Key` header → `Booking.idempotency_key`, patient-scoped replay returns the original row. | `bookings/services.py` |
| Reschedule | Cancel-then-rebook in one transaction under row locks; 24 h rule checked against the original slot. | `bookings/services.py::reschedule_booking` |
| Cancellation notifications | Provider cancel requires a reason; patient notified by email and (opt-in via phone + carrier) SMS over the carrier's email gateway; hourly per-recipient budget; endpoint throttle. | `bookings/notifications.py`, §7a |
| Auth hardening | Refresh rotation with reuse detection and grace window; `X-Requested-With` CSRF mitigation; per-IP login throttle + per-account lockout; password change invalidates other sessions; bcrypt. | `accounts/tokens.py`, `accounts/csrf.py`, `accounts/lockout.py` |
| Account deletion | Password-confirmed, transactional PHI scrub in place (never a hard delete), cancels upcoming bookings bypassing the 24 h rule, `deleted_at` tombstone. | `accounts/services.py`, `backend/docs/retention-policy.md` |
| Audit immutability | ORM guards + Postgres trigger; every admin bypass and admin audit read is itself logged. | `audit/models.py`, `audit/migrations/0002_*` |
| Request hygiene | 64 KB body cap → JSON 413 before parsing; `Cache-Control: no-store` + `Vary: Cookie` on every response; JSON-only exception handler (DB errors → 503, anything else → 500 JSON, never an HTML error page); JSON log lines outside debug. | `core/middleware.py`, `core/exceptions.py`, `core/logging.py` |
| Throttling & cache | DRF throttles (`anon` 100/min, `user` 300/min, `login` 5/min, `booking_cancel` 10/min) and the lockout counter share a Postgres-backed `DatabaseCache` (`django_cache`, created by `createcachetable` in the Railway start command) so limits hold across gunicorn workers; `LocMemCache` in debug/tests. | `config/settings.py` |
| Slot query bounds | `GET /scheduling/slots` spans ≤60 days; a provider with no hours at all returns `bookable: false` with a reason instead of an empty list; a patient's own bookings with other providers are subtracted. | `scheduling/slots.py`, `scheduling/views.py` |
| Frontend guard | `proxy.ts` (Next 16's request interceptor) calls `GET /auth/me` server-side for `/patient/*`, `/provider/*`, `/admin/*`, `/settings/*` and redirects before render; fails closed if the backend is unreachable. | `frontend/proxy.ts`, `lib/auth/route-guard.ts` |
| Theme | Light/dark toggle persisted in `localStorage` (the only thing stored there — never tokens), OKLCH tokens with a contrast test. | `frontend/lib/theme`, `theme-contrast.test.ts` |
