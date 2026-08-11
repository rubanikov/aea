# TICKET-01 — Project Skeleton, CI, Nav Shell & Deployed Health Check

**Blockers:** none
**Scope:** Both
**Size:** Right-sized (larger than typical, justified — one-time bootstrap)

## Build
- Django project + Next.js/TypeScript project (monorepo or two-repo — implementer's call).
- Postgres connection to Supabase.
- `GET /health` endpoint reporting app + DB reachability.
- CI: tests + lint on push, both apps.
- Baseline migrations + minimal seed script (a couple of demo provider/patient/admin accounts).
- Initial Railway (backend) + Vercel (frontend) deploy wired to CI so every later ticket auto-deploys.
- **Role-gated navigation shell**: distinct patient/provider/admin nav and route guarding — every later ticket's screens mount into this. Without it, tickets 02+ have nowhere defined to mount their UI.

## Accept
- Clean checkout → `migrate` + seed script → app runs locally and at a deployed URL.
- CI fails the pipeline on a failing test or lint violation.
- `GET /health` returns 200 with DB-reachable status at the deployed URL; returns a clear degraded status (not a 500) if DB is unreachable.
- `.env.example` documents every variable needed so far; no secrets committed.
- Visiting a provider-only route while unauthenticated (or as a patient) redirects/rejects rather than rendering.
