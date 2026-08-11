# Frontend

Next.js (App Router, TypeScript) frontend for the patient appointment &
scheduling portal.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (Next.js will pick the
next free port if 3000 is taken; check the terminal output).

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

## Auth, roles & account settings

`lib/api/client.ts` is the one place that talks to the backend
(`NEXT_PUBLIC_API_URL`, default `http://localhost:8000`), always with
`credentials: "include"` so the httpOnly session cookie rides along, and
with `X-Requested-With: XMLHttpRequest` on every unsafe-method request (the
backend's CSRF mitigation for a cookie-delivered auth token).

- `/patient/*`, `/provider/*`, `/admin/*` are gated by role; `/settings` is
  gated to "any authenticated role" (no `/settings/*` sub-routes gated by a
  specific one). `proxy.ts` enforces this **before** any of those routes
  render, by calling `GET /auth/me` server-side with the incoming request's
  cookies forwarded. An unauthenticated or wrong-role visit is redirected
  (to `/login` or `/access-denied`), never rendered, and a down/unreachable
  backend fails closed (redirects rather than lets the visit through). See
  `lib/auth/route-guard.ts` for the pure redirect logic and `proxy.test.ts`
  / `lib/auth/route-guard.test.ts` for the tests.
- `hooks/use-current-user.ts` exposes `useCurrentUser()` (`GET /auth/me` on
  mount) for the nav's "who am I" display only; it never gates rendering,
  that's `proxy.ts`'s job. A 401 there means the session died since
  navigation (every call site is inside a route `proxy.ts` already
  confirmed), so it's treated as session-expiry: redirect to
  `/login?session_expired=1`, which `/login` reads and surfaces as a clear
  message. `hooks/use-authenticated-request.ts` does the same for the
  account settings page's `/profile` and `/profile/password` calls.
- `/login` is a tabbed register/login screen
  (`components/auth/AuthPageClient.tsx`, `LoginForm.tsx`, `RegisterForm.tsx`)
  with inline, per-field validation (client-side and from the API's
  field-level error responses), a real password show/hide toggle, and a
  loading state on submit. On success it reads the role from `GET
  /auth/me` and redirects to `/patient`, `/provider`, or `/admin`.
- `/settings` (`components/settings/ProfileForm.tsx`, `PasswordForm.tsx`,
  `DeleteAccountSection.tsx`) covers profile view/edit (name, email, phone,
  timezone via `GET`/`PATCH /profile`), password update
  (`POST /profile/password`), and account deletion ("Danger zone", via
  `POST /profile/delete-account`).

To try it locally: `npm run dev`, then visit `/login` and register (or log
in with a seeded demo account; see the backend's `seed_demo` command) to
land on the matching role's dashboard. Visiting another role's route
afterwards redirects to `/access-denied`; a fresh/incognito visit to a
gated route redirects to `/login`.

## Deployment

This is a stock Next.js App Router project. Vercel's zero-config detection
picks it up with `frontend/` set as the project root. No `vercel.json` is
needed yet.
