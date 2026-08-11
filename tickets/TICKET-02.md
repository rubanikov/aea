# TICKET-02 — Registration, Login, Roles & Account Settings

**Blockers:** TICKET-01
**Scope:** Both
**Size:** Right-sized

## Build
- Patient/provider/admin signup + login, session handling, role assignment.
- **Account settings UI** (widened scope — see `wireframes.html` Screen 4 upper section): profile view/edit (name, email, phone, timezone), password update. Deletion-request UI is a separate concern owned by TICKET-14 — do not build it here.

## Accept
- New patient can register and log in; password hashed (bcrypt/argon2), never logged or stored plaintext.
- Sessions expire; unauthenticated request to any patient/provider resource is rejected server-side (not just hidden client-side).
- Role is assigned and enforced (patient/provider/admin) — a role check exists even though row-level ownership enforcement lands in TICKET-03.
- Basic protection against common auth attacks (rate-limited login, CSRF where applicable).
- A logged-in user can view and update their profile fields and password; validation errors are inline and specific (e.g. "Passwords don't match").
