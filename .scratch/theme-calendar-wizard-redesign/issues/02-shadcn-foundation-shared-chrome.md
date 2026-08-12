# 02 — shadcn/ui component foundation adopted in shared chrome

**What to build:** The shared nav/badge/toggle chrome a user sees on every screen is rebuilt on real shadcn/ui primitives sitting on the token system from `01`, still correctly themed in both modes.

**Blocked by:** 01 — Theme mechanism (Light/Dark/System) live across the app shell

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** shadcn config (`components.json`, `components/ui/*` new), `components/nav/AppShell.tsx`, `components/nav/UserBadge.tsx`, `components/theme/ThemeToggle.tsx`

## Acceptance criteria
- [ ] shadcn/ui CLI-generated primitives added unmodified (button, dialog, popover, select, card, badge, and whatever else `AppShell`/`UserBadge`/`ThemeToggle` actually consume — expand the set as later tickets need more, don't pre-generate speculatively)
- [ ] `--destructive` resolves through to `--danger` and is verified on a destructive-variant Button
- [ ] `AppShell.tsx` nav rebuilt on shadcn primitives (Button/Card as appropriate); `UserBadge.tsx` rebuilt on Badge/Popover as appropriate
- [ ] `ThemeToggle.tsx` from `01` rebuilt on a shadcn primitive (e.g. ToggleGroup/Tabs) instead of raw markup, same behaviour preserved
- [ ] Visual and functional parity in both light/dark; existing role-nav/tab regression tests (`AppShell.test.tsx`, `UserBadge.test.tsx`) updated and green

## Brief anchors
- API: None — frontend-only
- UI/wireframe: Brief stage 2 of the staged rollout. shadcn/Radix dependency already accepted by prior gate — do not re-litigate.
- Note: demoable outcome is "the shell you actually see is now built from the design system," not primitives sitting in a folder unused.
