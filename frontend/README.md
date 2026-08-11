# Frontend

Next.js (App Router, TypeScript) frontend for the patient appointment &
scheduling portal.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (Next.js will pick the
next free port if 3000 is taken — check the terminal output).

Copy the root `.env.example` and fill in `NEXT_PUBLIC_API_URL` (and the
backend vars, for the backend) if you need to point at a non-default API URL.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve a production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint-config-next`), fails on any warning |
| `npm test` | Run the Vitest suite once (CI-friendly) |
| `npm run test:watch` | Vitest in watch mode, for local dev |

## Role-gated nav shell (TICKET-01)

There is no real authentication yet (that's TICKET-02). This ticket lays
down the *shape* of role-gated routing so later tickets have somewhere to
mount their screens:

- `/patient/*`, `/provider/*`, `/admin/*` are gated by role.
- `proxy.ts` (Next.js's server-side request hook — the renamed `middleware.ts`
  as of Next 16) enforces this **before** any of those routes render: an
  unauthenticated or wrong-role visit is redirected (to `/login` or
  `/access-denied`), never rendered. See `lib/auth/route-guard.ts` for the
  pure redirect logic and `proxy.test.ts` / `lib/auth/route-guard.test.ts`
  for the tests.
- Since there's no real session, role is faked with a `demo_role` cookie
  (`lib/auth/mock-session.ts`). The `/login` page's role switcher
  (`components/auth/DemoRoleSwitcher.tsx`) sets it; the nav's "Log out"
  clears it.
- `hooks/use-current-user.ts` exposes `useCurrentUser()`, a placeholder for
  the nav's "who am I" display. It is **not** used for access control —
  that's `proxy.ts`'s job — and every file in this mock-auth path is marked
  `TODO(TICKET-02)` for what replaces it once real login exists.

To try the three roles locally: visit `/login`, pick a role, and you'll land
on that role's dashboard with a matching nav. Visiting another role's route
afterwards redirects to `/access-denied`; clearing cookies (or opening a
private window) and visiting a gated route redirects to `/login`.

## Deployment

This is a stock Next.js App Router project — Vercel's zero-config detection
picks it up with `frontend/` set as the project root. No `vercel.json` is
needed yet.
