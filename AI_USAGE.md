# AI Usage Disclosure

## Runtime AI

**None.** The optional natural-language booking stretch feature (project.md #12) was not built, so no LLM runs as part of the deployed application. Nothing in the request/response path of any endpoint calls an AI model. This statement is here explicitly per project.md's "AI Usage Disclosure" requirement — stating clearly that no runtime AI was used.

## AI used for code generation

The entire codebase — backend, frontend, tests, infrastructure config, and this documentation — was built using **Claude Code** (Anthropic's CLI agent), primarily **Claude Sonnet 5**, across several distinct phases:

1. **Research.** Two research passes against primary sources (official docs, vendor pricing pages, and the source code of real open-source scheduling systems — Cal.com, Medplum, OpenEMR, Easy!Appointments) informed the tech-stack choice and the core architecture, particularly the double-booking guard design and the RBAC/audit-log pattern. See `tech-stack-research.md` and `prior-art-research.md` for the full findings and citations.

2. **Design.** `architecture.md` synthesizes the research into concrete decisions (data model, the two-layer double-booking guard, status-lifecycle transition table, timezone handling, RBAC/PHI approach, reminder dispatch design) before any code was written.

3. **UX design.** Wireframes for the nine core screens were produced next, explicitly basing each screen's interaction pattern on a specific researched system (e.g. Cal.com's slot picker, Easy!Appointments' provider working-hours form, OpenEMR's collision-warning modal concept) rather than designing from scratch.

4. **Implementation.** The work was sliced into 14 vertical tickets (`tickets/`), each covering one end-to-end slice (e.g. "booking creation + double-booking guard," "provider availability + slot engine"). Tickets were implemented by specialized backend/frontend builder agents working from the approved architecture and ticket text, run in parallel where tickets had no file overlap, with a human-in-the-loop (the requester) approving the plan, the wireframes, and the ticket breakdown before implementation began.

5. **Verification.** After all tickets landed: a dedicated acceptance-test pass wrote end-to-end tests against project.md's own stated acceptance criteria (finding one genuine defect — see below); a security audit reviewed the finished system for OWASP-style and PHI-specific issues (0 Critical/High findings, 5 Medium addressed); an implementation-validator agent compared the finished system against the original brief and tickets for gaps, drift, and duplicated logic.

6. **Fix pass.** All findings from steps 5 were triaged and fixed, then re-verified with the full test suite before this commit.

7. **Final polish.** A last pass applied `code-humanizer`/`humanizer` cleanup, then a two-axis code review (Standards: Fowler smell baseline; Spec: project.md/architecture.md/tickets) against the whole build. This is also where the two items below were caught and fixed.

8. **Live run-through.** The passing test suites (623 backend / 696 frontend at the time of writing) never actually exercise a real running server — they go through Django's/Vitest's test clients, which skip real process boundaries. As a last check, both dev servers were started for real (Docker Postgres, `manage.py runserver`, `npm run dev`) and the core patient/provider journey was driven end to end over real HTTP: register, log in, browse a provider's real open slots, book (confirming the auto-accept rule fires immediately), hit the double-booking guard on a repeat request, log in as the provider and confirm the booking appears, confirm a *different* provider can't see or act on it, hit the 24h reschedule-notice rule, reschedule and cancel successfully, and check the change history in the admin audit log. This caught a real bug the test suite structurally couldn't: see below.

## Where AI judgment materially shaped the solution

A few decisions were made by the AI during implementation, based on engineering judgment rather than an explicit instruction, and are documented inline in code comments/docstrings at the point of decision (this codebase is deliberately comment-heavy on *why*, not *what*, for exactly this kind of traceability):

- The double-booking guard combines two independently-sourced mechanisms (Medplum's `SERIALIZABLE`-transaction pattern and Cal.com's unique-constraint backstop) rather than picking one, since neither real system studied combined both — see `architecture.md` §3.
- During final verification, two genuine race conditions in the reschedule/booking guard were found (not by asserting the design was correct, but by actually running the concurrency tests dozens of times) and fixed — see the "TICKET-10" and "Fix security audit findings" commits for the specific bugs and reasoning.
- Appointment duration was made per-appointment-type (provider-configurable, later constrained to exactly 30 or 60 minutes so the hour-block booking rule and the k6 slot counts stay predictable) rather than a single global slot length, after checking real-world scheduling-duration norms against primary sources rather than assuming a fixed value.
- Supabase Row-Level Security, listed as a candidate DB-layer backstop in the original brief, was deliberately not implemented — it assumes Supabase Auth as the identity provider, and this build uses a custom JWT-cookie auth system instead. This is documented as a considered decision in `architecture.md` §6, not an oversight (an implementation-validator pass flagged its absence, prompting the documentation to be added).
- The final-polish code review found two real gaps against project.md's own Security and Code Quality sections: passwords were hashed with Django's implicit PBKDF2 default rather than the bcrypt/argon2 the brief names explicitly, and the ≥80% test-coverage requirement had no CI enforcement behind it (the `coverage` tool was installed but never actually invoked). Both were fixed directly rather than just noted: `PASSWORD_HASHERS` now puts bcrypt first (PBKDF2 stays second so already-hashed rows keep verifying — no forced password reset), and CI now runs `coverage run`/`coverage report` against a committed `fail_under = 80` gate. The real number came back at 98% backend-wide, 100% on every core-logic module (booking engine, slot generation, transitions, reminders) — the code was already there, it just wasn't being checked.
- The live run-through (see above) found a bug none of the backend tests could have caught by construction: `.env.example` documents `JWT_SECRET_KEY` as present-but-empty ("falls back to `DJANGO_SECRET_KEY` if unset"), but `os.environ.get("JWT_SECRET_KEY", SECRET_KEY)` only applies that fallback when the key is *missing* from the environment, not when it's set to `""` — which is exactly what following the README's own `cp .env.example .env` instruction produces. Every registration or login would have hit PyJWT's `InvalidKeyError` on a real server. CI never sets `JWT_SECRET_KEY` at all, so it only ever saw the "missing" case, never the "present but empty" one the documented setup actually creates — no amount of running the existing test suite harder would have surfaced this; it took starting a real server and registering a real account. Fixed by switching to `os.environ.get("JWT_SECRET_KEY") or SECRET_KEY`, which treats both cases the same way.

## Model/engine versions

- Claude Sonnet 5 (`claude-sonnet-5`) — orchestration, research, design, and the majority of implementation/verification work.

No other AI model or engine was used anywhere in this repository.
