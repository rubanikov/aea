# Patient Appointment & Scheduling Portal

## Difficulty & Timebox
**Tier:** Midâ€“Senior Â· **Timebox:** 3 days Â· **Format:** take-home assessment
**Target industry:** Healthcare, Wellness & Life Sciences

*(3 days is justified by the combined scope of a correctness-critical booking engine â€”
no double-booking under concurrency â€” a two-sided calendar model (patient + provider),
an appointment status lifecycle, automated reminders, and first-class handling of PHI.)*

## Problem Statement
Build a web application where patients book, reschedule, and cancel appointments with
healthcare providers, and providers manage their availability and calendar. Scheduling
today is dominated by phone tag: patients call during office hours, front-desk staff
read back open slots, and missed appointments (no-shows) go unmanaged. The portal lets
a patient self-serve â€” see a provider's genuinely open slots for a given service and
book one in seconds â€” while giving providers control over their working hours, slot
length, and blocked time. Automated reminders reduce no-shows, and a clear status
lifecycle (requested â†’ confirmed â†’ completed / cancelled / no-show) keeps both sides
in sync.
Target users: a **patient** who wants to book care quickly without calling, and a
**provider** (and their front-desk **admin**) who wants an always-correct calendar
that never double-books and reminds patients automatically.

## Business Context
Manual phone scheduling is expensive and lossy: staff spend hours per day on the phone,
open slots go unfilled because patients can only book during office hours, and no-shows
waste clinician capacity that cannot be recovered. Every no-show is paid-for provider
time that produces no care and no revenue, and every unfilled slot is lost throughput
in a system where clinician time is the scarcest resource. A self-service portal with
automated reminders attacks all three at once â€” it shifts booking off the phone, opens
booking to 24/7, and nudges patients to show up â€” which is why patient-scheduling
software is a durable, high-ROI category in healthcare operations.

## Illustrative Business Case / Impact Metrics
*Illustrative â€” assumptions stated inline; validate against real clinic analytics.*
Assume a **clinic of 10 providers**, each with **32 appointment slots/week**, i.e.
**320 slots/week â‰ˆ 16,000 slots/year** (50 working weeks).
- **No-show reduction:** lower the no-show rate from an assumed baseline of **20%** to
  **12%** (**âˆ’8 pts, âˆ’40% relative**) via automated reminders. On 16,000 booked slots
  that is **~1,280 recovered visits/year**; at an illustrative **$120 contribution per
  visit**, **~$154,000/year** in recovered capacity. *(Assumption: 20% baseline is
  typical for reminder-free outpatient scheduling; confirm against clinic data.)*
- **Front-desk labor:** shift **60%** of scheduling off the phone. Assume **150
  scheduling calls/week** at **4 min each = 10 hrs/week**; removing 60% saves **6
  hrs/week â‰ˆ 300 hrs/year**; at an illustrative **$25/hr** loaded cost, **~$7,500/year**.
- **Slot utilization:** raise utilization from an assumed **80%** to **88%** (**+8 pts**)
  by opening 24/7 self-booking and auto-filling from a waitlist (stretch). On 16,000
  slots that is **~1,280 additional filled slots/year**.
- **Booking responsiveness (product guardrail):** slot-availability and booking actions
  **< 1 s p95** under a stated load â€” see Performance Benchmarks; a slow or stale slot
  view re-introduces the double-booking and abandonment the product exists to remove.

## Tech Stack
Concrete free-tier defaults; substitution allowed if justified and benchmarks met.
**No paid API is required. 100% free-tier.**
- **Backend (candidate choice, pick one):** **Ruby on Rails** *or* **Node/Express**
  *or* **Django** â€” all free and open source.
- **Frontend:** **React / Next.js (TypeScript)**.
- **Database + Auth:** **PostgreSQL via Supabase** (free â€” Postgres + Auth, well suited
  to identity + row-level access) *or* **Neon** (free Postgres). Postgres is
  recommended specifically because transactional row-locking is central to the
  no-double-booking requirement.
- **Cloud Platforms:** **Render** or **Railway** (backend hosting, free tier) +
  **Vercel** or **Netlify** (frontend hosting, free tier).
- **Email reminders:** **Resend free tier** (recommended default). SMS reminders are an
  **optional** substitute/addition via a paid provider such as **Twilio** ðŸ’² â€” **not
  required**; email satisfies the reminder requirement.
- **AI / LLM (optional only):** used **only** if the candidate builds the optional
  natural-language booking stretch feature. **Groq free tier**, **Google Gemini free
  tier**, or **Ollama (local)** â€” pick one; **no paid API required.** No AI is required
  to pass this brief (see AI Metrics & Test Method).
- **Development Tools:** Git, Docker (optional), a test framework (RSpec / Jest / pytest),
  and **k6** for load testing.

## Functional Requirements
Each Core item has an observable acceptance criterion (pass/fail). The optional
natural-language feature's golden set and threshold are defined in **AI Metrics & Test
Method**.

### Core (must-have)
1. **Patient registration & authentication** â€” patients sign up, log in, and manage a
   basic profile.
   *Accept:* a new patient can register and log in; passwords are hashed (never stored
   in plaintext); sessions expire; an unauthenticated request to any patient resource
   is rejected.
2. **Provider availability management** â€” a provider defines working hours, slot length,
   and blocked/unavailable times.
   *Accept:* a provider sets working hours (e.g. Monâ€“Fri 09:00â€“17:00), a slot length
   (e.g. 30 min), and blocks a specific range; the generated open-slot list reflects all
   three, and blocked/past times never appear as bookable.
3. **Slot discovery & booking** â€” a patient views open slots for a chosen provider/
   service and books one.
   *Accept:* the patient sees only genuinely open, future slots for the selected
   provider/service; booking one creates a persisted appointment, returns a
   confirmation, and immediately removes that slot from the open list.
4. **No double-booking (critical correctness test)** â€” the same slot cannot be booked
   by two patients.
   *Accept:* under a **concurrent booking attempt on the last open slot** (two requests
   fire simultaneously), **exactly one** succeeds and the other receives a clear
   "slot no longer available" error â€” never two confirmed appointments for one slot.
   This must hold under DB-level concurrency (e.g. transactional row lock / unique
   constraint), verified by an automated concurrent test committed to the repo.
5. **Reschedule & cancel** â€” a patient reschedules or cancels an appointment under
   stated rules/notice.
   *Accept:* a patient can move an appointment to another open slot (freeing the old
   slot atomically) or cancel it; a stated minimum-notice rule (e.g. no changes
   < 24 h before start) is enforced server-side, and the freed slot becomes bookable
   again.
6. **Appointment status lifecycle** â€” appointments move through a defined status set.
   *Accept:* an appointment transitions **requested â†’ confirmed â†’ completed /
   cancelled / no-show**; only valid transitions are allowed (e.g. a cancelled
   appointment cannot be marked completed), transitions are role-appropriate, and each
   change is recorded (see audit log).
7. **Automated email reminders** â€” patients receive a reminder before the appointment.
   *Accept:* a scheduled job dispatches an email reminder a stated interval before the
   appointment (e.g. 24 h prior) via Resend; dispatch is idempotent (no duplicate
   reminders for the same appointment) and delivery/attempt is logged.

### Stretch (bonus)
8. **Waitlist + auto-fill on cancellation** â€” patients join a waitlist for a full
   provider/day; when a slot frees, the next waitlisted patient is offered/booked in.
9. **Telehealth video link** â€” confirmed appointments carry a generated video-visit link.
10. **Recurring appointments** â€” book a repeating series (e.g. weekly for 6 weeks).
11. **Insurance / intake field capture** â€” structured intake and insurance fields
    collected at booking (treated as PHI â€” see Security, Privacy & Compliance).
12. **Natural-language booking (optional AI)** â€” a patient types "book me next Tuesday
    afternoon" and the system proposes the matching slot; graceful fallback on ambiguity.

### Edge Cases & Failure Modes
The solution **must** handle the following; each is an observable expectation a reviewer
can trigger, and a happy-path-only submission should visibly fail here.
1. **Time zones & DST across the two sides.** When patient and provider are in different
   time zones, every slot displays unambiguously in each viewer's local zone and the
   stored appointment resolves to a single correct instant. A slot that spans a DST
   transition (spring-forward / fall-back) is generated and totalled correctly â€” no
   duplicated, skipped, or off-by-one-hour slots. Times are persisted in UTC (or with an
   explicit zone), never as naive local strings.
2. **Concurrent booking on the last open slot.** Two simultaneous bookings on the final
   slot resolve to **exactly one** confirmed appointment; the loser gets a clear "slot no
   longer available" response â€” see Core #4 (the critical concurrency correctness test),
   which this edge case references and does not replace.
3. **Provider edits availability that collides with an already-booked slot.** When a
   provider shrinks working hours, changes slot length, or blocks a range that overlaps an
   **existing confirmed booking**, the booked appointment is **protected** â€” it is never
   silently deleted or double-booked. The system either rejects the conflicting edit with
   a clear message listing the affected appointments, or accepts the edit while preserving
   the booked slot and flagging it for provider/admin follow-up. Only genuinely free time
   is removed.
4. **Reminder idempotency.** The reminder job is safe to run repeatedly and to overlap
   with itself (retry, crash-and-restart, double-schedule) without ever sending a second
   reminder for the same appointment/interval â€” enforced by a persisted per-appointment
   send record or equivalent guard, not by timing luck.
5. **Double-submit of a booking.** A patient double-clicking "book" (or a retried request)
   creates **at most one** appointment for that slot â€” deduplicated server-side (e.g.
   idempotency key / unique constraint), not merely by disabling the button client-side.
6. **Cancel / no-show transition rules.** Only valid lifecycle transitions are permitted:
   a **cancelled** appointment cannot later be marked **completed**, **no-show** applies
   only to a **confirmed** appointment whose start time has passed, and cancelling frees
   the slot atomically for rebooking. Invalid transitions are rejected server-side with a
   clear error, not silently ignored.
7. **Graceful degradation & input validation.** The primary dependency failing (database,
   email/reminder provider, or the optional LLM) degrades gracefully with a clear
   user-facing message and a structured server-side error log â€” never an unhandled 500 or
   a silently wrong result (e.g. a reminder-provider outage is queued/retried, not lost).
   All external input (booking, availability, status-change, and auth payloads) is
   validated and sanitized **server-side**, and malformed/oversized/out-of-range requests
   are rejected with clear errors â€” first-run/empty state (a provider with no availability,
   a patient with no appointments) renders cleanly rather than erroring.

## Performance Benchmarks
Load is defined explicitly so results are comparable across candidates.
**Stated load:** **20â€“50 concurrent virtual users** for 60 s, generated with **k6**
(script committed to the repo), against a **seeded dataset** (e.g. 10 providers,
~16,000 slots).

| Target | Value | Measurement method |
|--------|-------|--------------------|
| Slot-availability query | < 1.0 s p95 | k6 run at the stated load against the seeded dataset; report p95 |
| Booking action | < 1.0 s p95 | Server log timing from request to persisted confirmation, 20+ runs |
| No double-booking under concurrency | 1 success / Nâˆ’1 rejected | Automated concurrent test: N simultaneous bookings on the last open slot; assert exactly one confirmed appointment for the slot |
| Reminder dispatch reliability | â‰¥ 99% of due reminders sent, 0 duplicates | Reminder job logs across the eval window; assert one attempt per due appointment |
| Uptime (deployed demo) | â‰¥ 99% over the eval window | Uptime check (e.g. cron ping) across the review period |

## AI Metrics & Test Method
**AI is optional in this brief and is primarily used for code generation**, not for a
required core accuracy metric â€” the core product is a correctness-critical booking
engine, not an AI model. There is **no required AI accuracy threshold** to pass.

**Only if** the candidate builds the optional **natural-language booking** stretch
feature, apply a **lightweight golden set**:
- **Golden set:** **~15 labeled utterance â†’ intended-slot/intent pairs** (e.g. "next
  Tuesday afternoon", "earliest with Dr. Lee", "cancel my Friday visit", plus a few
  ambiguous/out-of-scope inputs).
- **Threshold:** **â‰¥ 80% correct slot/intent** on the set, with a **graceful fallback
  on ambiguity** (ask a clarifying question or show candidate slots â€” never silently
  book the wrong slot).
- **Method:** a committed harness (e.g. `rake ai:eval` / `npm run ai:eval`) runs the set
  and prints a per-utterance pass/fail scorecard; model/engine version and hardware are
  recorded in the README. Utterances must be synthetic â€” never real patient data.

## Security, Privacy & Compliance
This domain handles **Protected Health Information (PHI)**: patient identity,
appointments with named providers, and (in stretch) intake/insurance data. PHI handling
is **first-class**, not an add-on, and the design should demonstrate **HIPAA awareness**.
- **HIPAA / PHI awareness:** treat appointment and patient data as PHI; the README must
  state which data is PHI and how the design protects it. This is a demonstration of
  awareness and sound practice, not a claim of certified compliance.
- **Role-based access control (server-side):** three roles â€” **patient / provider /
  admin** â€” enforced on the server (never trust the client). A **patient sees only their
  own appointments**; a **provider sees only their own schedule and their own patients**;
  admin access is scoped and logged. Authorization is checked on every PHI endpoint
  (row-level ownership, e.g. Postgres RLS or explicit server-side checks).
- **Encryption:** **TLS/HTTPS in transit**; **encryption at rest** for the database and
  any stored PHI.
- **Audit log of PHI access & booking changes:** every PHI read of note and every
  booking/status change (create, reschedule, cancel, status transition) is recorded with
  **actor, action, target, and timestamp**; the log is append-only and reviewable.
- **Data minimization & retention/deletion:** collect only the fields the flow needs;
  a stated **retention and deletion policy** (how long appointment/intake data is kept,
  and how it is purged); patients can request deletion of their data.
- **No PHI in logs:** application/server logs must not contain PHI (names, DOB, contact
  details, health context); log identifiers/references instead.
- **Secure authentication:** hashed passwords (bcrypt/argon2 â€” never plaintext),
  session expiry, and protection against common auth attacks; secrets in env vars only,
  **never committed and never logged**. A committed **`.env.example`** documents every
  required variable (with placeholder values only) so the app configures from a clean
  checkout.
- **Business Associate Agreement (BAA):** any third-party service that stores or
  processes PHI (e.g. hosting, database, email/SMS handling PHI content) requires a
  **BAA** for real-world use. Keep PHI out of reminder message bodies where possible
  (send a generic reminder + secure link) to limit third-party PHI exposure, and
  disclose which vendors would need a BAA.

## Code Quality & Engineering Practices
- **Test coverage â‰¥ 80%** on core logic (availability/slot generation, the booking
  engine and its concurrency guard, reschedule/cancel rules, status-lifecycle
  transitions, reminder scheduling).
- **Concurrency correctness is tested:** the no-double-booking guard has an explicit
  automated concurrent test (see Performance Benchmarks), not just a happy-path test.
- **Error handling & observability:** clear, non-500 responses for booking conflicts,
  invalid status transitions, and reminder-send failures (retry/queue); no unhandled 500s
  in the demo flow. **Structured error logging** (no PHI â€” log identifiers/references
  only) and a **health-check endpoint** (e.g. `GET /health`) that reports app and database
  reachability for the deployed demo.
- **Accessibility (patient & provider UI):** baseline WCAG-aware practice â€” full keyboard
  navigation of the booking and availability flows, labeled form controls and slot
  buttons, sufficient colour contrast, and appointment status conveyed by more than colour
  alone (text/icon label, not colour-only).
- **Database migrations:** schema (including unique constraints / indexes backing the
  no-double-book guarantee) managed via committed migrations; reproducible from a clean
  checkout with a seed script.
- **Secure coding for PHI:** no secrets in the repo (env vars only); no PHI in logs;
  input validation on all booking/availability endpoints; server-side authorization on
  every PHI route.
- **CI:** runs tests + linter (RuboCop / ESLint / Ruff as appropriate) on every push;
  README documents setup, env vars, the seed script, and how to run the concurrency and
  (optional) AI eval harnesses.

## AI Usage Disclosure
**Required.** Document, in `AI_USAGE.md`: which AI tools were used and for what
(primarily code generation; and, if built, the optional natural-language booking
feature), which LLM/engine and versions were used for any runtime AI, and any prompts or
configuration that materially shaped the solution. State clearly if no runtime AI was
used.

## Submission Requirements
- GitHub repository (with README + `AI_USAGE.md`)
- Deployed application URL
- Documentation (setup, env vars, seed script, retention/deletion policy, roles)
- **Committed `.env.example`** and a **committed seed script / sample dataset** (â‰ˆ10
  providers and their slots, demo patient + provider/admin accounts) so the app runs and
  is gradeable from a clean checkout.
- **Grader quick-start in the README:** a reviewer can install, configure from
  `.env.example`, seed, run the app, and run the committed test suite (incl. the
  concurrency test and, if built, the AI eval harness) **in minutes**, with any demo
  credentials listed.
- Video demo showing: **provider availability setup**, **patient booking**, the
  **no-double-book behavior** (concurrent attempt on the last slot), **reschedule/
  cancel**, and a **reminder** being sent/received.

## Evaluation Rubric (100 pts; pass â‰¥ 70)
| Criterion | Weight | Adequate â†’ Excellent |
|-----------|:------:|----------------------|
| Core booking flows work (register, availability, book, reschedule/cancel, lifecycle, reminders) | 30 | 1â€“2 flows â†’ all flows flawless with clean status lifecycle, incl. edge cases & failure modes (time zones/DST, availability-vs-booked collision, reminder idempotency, double-submit, cancel/no-show rules) |
| No double-booking under concurrency (critical correctness) | 20 | Passes serially only â†’ provably correct under concurrent load with a committed test |
| Security, privacy & compliance (PHI) | 20 | Basic auth â†’ server-side RBAC, audit log, encryption, retention/deletion, BAA awareness, no PHI in logs |
| Code quality & architecture | 15 | Works but coupled â†’ clean services, migrations/constraints, â‰¥80% coverage, CI |
| Performance (meets benchmarks) | 10 | Sluggish/stale slots â†’ all p95 targets met under stated load |
| Docs, AI disclosure & demo | 5 | Sparse â†’ clear README, policies documented, crisp demo of all required moments |
