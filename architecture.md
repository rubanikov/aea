# Architecture — Patient Appointment & Scheduling Portal

Decision date: 2026-08-10. This document turns the findings in `tech-stack-research.md` (candidate stack comparison) and `prior-art-research.md` (how five real booking/scheduling systems actually solve this problem) into a concrete build plan. Every non-obvious decision below is tied back to a specific finding in one of those two documents rather than asserted from scratch — see them for full sourcing and citations.

---

## 1. Stack

| Layer | Choice | Why (from `tech-stack-research.md`) |
|---|---|---|
| Backend | **Django** | `select_for_update(nowait=, skip_locked=)` is a first-class, typed API for the row-lock guard — directly usable for §3 below. Avoid Node+Prisma: no native `FOR UPDATE` support (unresolved upstream issue), disqualifying for a 20-point pass/fail concurrency gate. |
| Database | **Postgres** (Supabase-compatible connection string, plain `DATABASE_URL` in this build — see §6) | `select_for_update()` needs real row locks; SQLite is a silent no-op there. Auth is a custom JWT-cookie system rather than Supabase Auth, which took RLS off the table — see §6 for the full reasoning and what still enforces row-ownership instead. |
| Backend hosting | **Railway** | Render's free tier explicitly forbids background worker/cron service types — a hard blocker for the reminder job (§6). |
| Frontend hosting | **Vercel** | First-party Next.js integration; self-serve BAA path if this ever needs to be real. |
| Email | **Resend** | Only real free-tier option; reminder bodies stay PHI-free by design (no BAA available). |
| AI (optional stretch) | **Groq** | Free, documented rate limits, has an (excludes-free-tier) BAA program. Only needed if building the NL-booking stretch feature. |

---

## 2. Data model: compute slots, don't store them

Every system in `prior-art-research.md` that got this right — Cal.com, Medplum, Easy!Appointments — does the same thing despite three unrelated stacks: **a bookable slot is never a persisted row.** You store the inputs and compute availability at query time.

**Appointment duration is not a fixed constant — it's configurable per visit type.** Real-world scheduling standards vary widely: follow-ups commonly run 10–15 minutes, new-patient visits 20–45 minutes, and complex/physical exams up to 45–60 minutes, scheduled against a base grid increment (commonly 10 or 15 minutes) rather than one uniform slot length ([Incredible Health, nurse-sourced scheduling norms](https://www.incrediblehealth.com/nurse-advice/questions/4e88f69e/how-long-are-appointment-time-slots-and-how-many); [Houston Family Physicians, average visit duration](https://www.houstonfamilydoctors.com/average-primary-care-clinic-appointment-duration/)). This matches what Easy!Appointments already does in practice — its slot-generation code checks the remaining free time against "the **service's** duration," not a single global slot length (see `prior-art-research.md` §4). So duration belongs on a per-appointment-type record, not on `Availability`.

Core tables:
- **`AppointmentType`** (a.k.a. Service) — `provider_id`, `name` (e.g. "New Patient Visit", "Follow-up", "Annual Physical"), `duration_minutes`. A provider defines one or more of these; each booking is for a specific `AppointmentType`, and that type's duration is what actually sizes the slot at booking time.
- **`Availability`** — provider's recurring working hours (day-of-week + start/end time), plus optional date-specific overrides. Slot length no longer lives here — see `AppointmentType` above. Modeled on Cal.com's `Schedule`/`Availability` and Medplum's `SchedulingParameters` — *not* OpenEMR's approach (working hours as an ordinary recurring calendar event in a special category — a legacy artifact of forking a 2001 CMS calendar module, not a pattern worth repeating).
- **`BlockedTime`** — one-off provider unavailability (vacation, admin block), optionally scoped to a date range.
- **`Booking`** — the actual appointment: `provider_id`, `patient_id`, `appointment_type_id`, `start_time` (UTC), `end_time` (UTC, derived from `appointment_type.duration_minutes` at booking time), `status`, plus the unique constraint from §3.
- **`ReminderLog`** — append-only send record, see §6.
- **`AuditLog`** — append-only, `actor / action / target / timestamp`, see §5.

Open slots = `Availability ∪ overrides − (BlockedTime ∪ existing Bookings)`, discretized using the **selected `AppointmentType`'s duration**, computed fresh on every read. This also directly satisfies edge case #3 in the brief (provider shrinks availability without silently deleting a booked slot): because `Booking` is its own table, editing `Availability` never touches existing bookings — you're only changing what's bookable *going forward*. A provider-availability edit that would collide with an existing confirmed `Booking` should be flagged (diffed against current bookings) rather than silently applied — this is application logic, not something any of the five systems studied got right (OpenEMR and Easy!Appointments have no such collision check at all).

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
Cal.com's own docs note their equivalent key only catches *identical* start/end, not general overlap — that's fine here, because it's a last-line guarantee, not the primary mechanism. Even if a future refactor introduces a bug in the transaction logic above, the database itself cannot commit two active bookings for the same provider+slot. This is strictly more robust than either system alone, and it's exactly the "row lock + unique constraint" combination the brief specifies.

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
Modeled on Cal.com's `confirm.handler.ts` (guards re-entrancy — throws if a booking is already `ACCEPTED`) and OpenEMR's terminal-state checks (once a status is terminal, e.g. "coding done," nothing moves it further). One function is the single write path for every status change, which is also where the audit log entry gets written (§5) and where the brief's `no_show`-only-from-`confirmed`-past-start-time rule gets enforced.

**Business rule: patient-initiated bookings are auto-accepted.** The brief's own acceptance criteria mandate the literal sequence "requested → confirmed" (Core requirement #6), so the status is not skipped — but nothing waits on manual provider approval. `POST /bookings` (§3) creates the row as `REQUESTED` and, inside the *same* request/transaction, immediately calls `transition(booking, CONFIRMED, actor=system)`. The patient's observable experience is a single "your appointment is confirmed" response, not a pending state. This inverts the provider's role in the lifecycle: instead of a pre-emptive confirm/decline gate, the provider's lever is post-hoc — `CONFIRMED → CANCELLED` after the fact, if they need to cancel a booking that already went through. `REQUESTED` still exists as a real, observable transient state (satisfies the brief's transition test and leaves room for a future "requires manual approval" appointment type if ever needed), but the default and only currently-built path resolves it synchronously.

---

## 5. Time zones: UTC + separate per-actor zone, DST-tested

Store every timestamp in UTC (`DateTimeField` with `USE_TZ=True`). Store the provider's and patient's IANA timezone (`America/Chicago`, etc.) as separate fields — never fold a timezone conversion into a naive local string. This is the one thing every system in the research that handles multi-timezone correctly does (Cal.com: independent `timeZone` on Schedule *and* each Attendee row; Medplum: preserves submitted offset exactly, throws if a scheduled actor has no timezone extension), and the one thing both systems that got it wrong share (OpenEMR: one global process-wide timezone, naive `date`/`time` columns, no per-row offset at all; Easy!Appointments: the customer-facing timezone selector is display-only JS — `moment.tz(...)` re-renders the label, but the actual submitted `start_datetime` is built from the original provider-local string, so the "conversion" never reaches storage — a real, shipped bug worth explicitly not repeating).

Python's `zoneinfo` (stdlib, IANA-backed) handles DST arithmetic correctly by construction — same category as Medplum's `Temporal` and Cal.com's `dayjs`-with-explicit-offset-correction. But write an explicit test that generates slots across a DST transition week regardless: Cal.com needed dedicated, commented code (`processWorkingHours()` — computing the UTC offset at start-of-day vs. at the actual working-hours start time and correcting for the 60-minute difference) to get this right even with a DST-aware library underneath. A DST-aware library prevents *arithmetic* bugs, not *logic* bugs in how you apply it.

---

## 6. RBAC / PHI: DB-enforced row-level policy + app-level check, both layers

Every mature system in the research pairs a role→permission grant with an independent row-level ownership filter — Medplum's `AccessPolicy` + FHIR compartment (`%patient`), Cal.com's PBAC `Role`/`RolePermission` plus org `Membership`, Easy!Appointments' bitmask role matrix plus its separate `has_customer_access()` row-level check. OpenEMR is the counter-example: role grants only (phpGACL), no row-level layer found — a real gap, not a design worth copying.

Concretely:
- **DB layer:** planned as Supabase RLS policies keyed on `auth.uid()` — `patient_id = auth.uid()` on `Booking` reads for the patient role, `provider_id = auth.uid()` for the provider role, admin bypasses via a separate policy scoped and logged. **Not implemented in the actual build, by deliberate decision, not oversight:** `auth.uid()`-keyed RLS assumes Supabase Auth is the identity provider populating that session variable. TICKET-02 instead built a custom `accounts.User` model with JWT-in-httpOnly-cookie auth (architecture.md's own design, chosen for the cross-origin Vercel/Railway split — see tech-stack-research.md), so there is no `auth.uid()` for an RLS policy to key on without also adopting Supabase Auth specifically, which was never in scope. Writing RLS policies against a *different* identity mechanism (e.g. a custom Postgres session variable set per-request from the JWT) is possible but would be a parallel, independently-maintained authorization system alongside the app-layer checks below — exactly the "two guards that can drift apart" pattern this document argues against elsewhere (see §3's double-booking guard reasoning). The brief's own requirement is explicitly "Postgres RLS **or** explicit server-side checks" (project.md, Security section) — the app-layer half alone satisfies that bar on its own merits, verified by `audit/tests/test_permissions.py` and every ownership test across `scheduling`/`bookings`. If a future pass adopts Supabase Auth as the actual identity provider, RLS becomes straightforward to add as true defense-in-depth on top of the existing app-layer checks, not a replacement for them.
- **App layer:** every service method that touches a `Booking`, `Availability`, or PHI field re-checks ownership explicitly, rather than trusting RLS alone. This is the layer actually enforcing row-level ownership in the shipped build (see above) — `audit.permissions.IsOwnerOrAdmin` / `bookings.permissions.IsBookingProviderOrAdmin`, both audit-logging every admin bypass.
- **Audit log:** modeled on Medplum's approach (an `AuditLog` write generated automatically at the data-access layer on every PHI read/write and every status transition — not a documented developer responsibility bolted on later) and OpenEMR's tamper-evidence idea (a `checksum` field per row) if time allows. Every entry: `actor, action, target, timestamp`, append-only.
- **No PHI in logs:** application/server logs reference booking/patient IDs, never names or contact details — matches the brief directly and the pattern CallSphere's blog post (in `prior-art-research.md` §6) independently arrived at (`SafeLogger` hashes patient IDs before logging).

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

---

## 8. Explicit anti-patterns (confirmed present in real, shipped systems — don't repeat them)

| Anti-pattern | Where it was found | What to do instead |
|---|---|---|
| Pre-check-then-insert with no DB guard on booking creation | Easy!Appointments (admitted in its own code comment), OpenEMR (no guard at all) | §3 — transaction + row lock + unique constraint |
| Free-text status field, no transition guards | Easy!Appointments | §4 — closed enum + explicit transition table |
| Naive local timestamps / display-only timezone conversion that never reaches storage | OpenEMR (single global tz), Easy!Appointments (client-side-only conversion) | §5 — UTC + separate per-actor IANA zone, stored |
| Role grants with no row-level ownership check | OpenEMR (phpGACL only) | §6 — RLS + app-level check, both |
| Building a heavyweight, Enterprise-style workflow/automation engine for reminders | Cal.com's now-deleted Workflows engine — over-built relative to what shipped long-term | §7 — one cron job, one dedup table, keep it simple |

---

## 9. Open items to resolve during build

- Working-hours UI for provider availability setup — resolved by the UX wireframe pass (`wireframes.html`); the same pass extended Screen 5 to cover per-`AppointmentType` duration configuration (§2) alongside weekly hours.
- Whether the stretch waitlist feature (brief item #8) is in scope for this pass — if yes, it needs its own concurrency guard on "next waitlisted patient gets the freed slot," which none of the five systems studied implement in a way worth copying.
- Recurring-appointment stretch feature (#10) is out of scope for the architecture above; would need its own design pass if pursued.
- **Resolved, not open:** the two items above (§2 duration model, §4 auto-accept) were open questions the user resolved directly — durations are per-`AppointmentType`, not fixed, and patient bookings auto-confirm rather than waiting on manual provider approval.
