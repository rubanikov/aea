# 01 — Settings portal nav (Story 1)

**What to build:** Wire `/settings` into the existing portal shell so the correct role nav (provider / patient / admin) renders, the active link is marked `aria-current="page"`, and the provider's first link reads "Dashboard" pointing at `/provider/calendar`. A neutral loading header shows while the role is in flight; an unknown or null role falls back to the patient nav.

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** `app/settings/layout.tsx` (new), `components/nav/SettingsShell.tsx` (new), `components/nav/AppShell.tsx` (`"use client"`, `role: Role | null`, loading header, `aria-current`), `lib/nav-config.ts` (rename + comment), `app/settings/page.tsx` (`ROLE_HOME.provider` → `/provider/calendar`), `components/nav/AppShell.test.tsx` (loading-state, current-page, "Dashboard" label cases)

## Acceptance criteria
- [ ] `/settings` URL is unchanged after the layout is added.
- [ ] `SettingsShell` calls `useCurrentUser()`; while the role is `undefined` (in-flight) it renders `null` (no flash of wrong nav).
- [ ] `role === null` (fetch failed) renders the patient nav — never a blank or provider header.
- [ ] `AppShell` accepts `role: Role | null`; when `null`, it renders a full-height header with `aria-busy="true"`, an `aria-hidden` placeholder where the portal label goes, no `<nav>` and no links; `ThemeToggle` and `UserBadge` still render.
- [ ] Active link receives `aria-current="page"` via exact `usePathname()` match; `/provider` and `/provider/calendar` are never both active simultaneously.
- [ ] Provider's first nav link label is "Dashboard" and `href` is `/provider/calendar`.
- [ ] Settings page "Back to dashboard" link points at `/provider/calendar`.
- [ ] Component tests: loading state (no nav/links, `aria-busy`), correct-role nav, "Dashboard" label, `aria-current` on the active path.

## Brief anchors
- Wireframe: `.scratch/wireframes/settings-portal-nav-wireframe.html` — Panel C is the neutral loading header.
- Brief §Frontend Story 1 (lines 152–158).
- Test list: `/settings` role tests, loading state, "Dashboard" label, `aria-current` (brief lines 191–193, 208, 212).
