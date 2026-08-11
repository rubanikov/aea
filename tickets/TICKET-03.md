# TICKET-03 — RBAC Ownership Checks + Append-Only Audit Log (+ Viewer)

**Blockers:** TICKET-01, TICKET-02 (parallel with TICKET-04)
**Scope:** Both
**Size:** Right-sized

## Build
- `AuditLog` model/migration (actor, action, target, timestamp, append-only).
- Reusable server-side ownership-check utility (patient sees only own resources, provider sees only own, admin bypass logged).
- ~~Supabase RLS policies as the DB-layer backstop on tables that exist so far.~~ **Deliberately not built — see architecture.md §6.** RLS keyed on `auth.uid()` assumes Supabase Auth as the identity provider; TICKET-02 built a custom JWT-cookie auth system instead (chosen for the Vercel/Railway cross-origin split), so there's no `auth.uid()` session variable to key policies on without adopting Supabase Auth specifically. The app-layer ownership utility below satisfies the brief's own "RLS **or** explicit server-side checks" requirement on its own.
- **Admin audit-log viewer screen** (widened scope — see `wireframes.html` Screen 9): filterable, paginated, read-only table. Timestamps shown in UTC always (the one screen that deliberately does not localize to the viewer).

## Accept
- A non-owner request to another user's protected resource is rejected (403/404) even if RLS were somehow bypassed — app-layer check is independent of RLS, not trusting it alone.
- Every protected read/write through the utility produces an audit entry (actor/action/target/timestamp); log is append-only (no update/delete path exposed).
- Admin can view and filter the audit log (actor, action, target type, date range); non-admin cannot access it at all.
- Log entries reference IDs only — no names/DOB/contact details.

**Note:** every ticket from here on (04–14) is expected to route its PHI-touching endpoints through this ticket's ownership-check utility and audit-log helper — a soft integration dependency, not a hard rebuild-and-wait blocker.
