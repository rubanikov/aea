# 01 — Theme mechanism (Light/Dark/System) live across the app shell

**What to build:** A user can open the app, see System-default theme applied with no flash, switch to Light/Dark/System via a toggle in the header, have the choice persist per-browser, and see it live-follow OS changes when set to System. The full semantic-token color system backing this exists and is contrast-verified.

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** `app/layout.tsx`, `app/globals.css`, `lib/theme/ThemeProvider.tsx` (new), `lib/theme/oklch.ts` (new), `components/theme/ThemeToggle.tsx` (new), `components/nav/AppShell.tsx`

## Acceptance criteria
- [ ] Pre-paint inline script in `app/layout.tsx` reads `localStorage["aea-theme"]` and toggles `.dark` on `documentElement` before first paint (no-flash test)
- [ ] `ThemeProvider` (new) owns Light/Dark/System state, subscribes to `matchMedia` for System, live-updates without reload
- [ ] `ThemeToggle` (new) 3-way segmented control mounted in `AppShell.tsx` header for patient, provider, and admin roles
- [ ] Default is System when no stored preference exists
- [ ] Selection persists across reload (localStorage round-trip test)
- [ ] `app/globals.css` Layer A: neutral 11-step, brand/blue 9-step, four status families (success/warning/danger/info, 8-step each), 8-hue categorical tag ramp — copied literally from Tailwind v4 theme.css
- [ ] `app/globals.css` Layer B: semantic tokens (`--background`, `--card`, `--primary`, `--primary-subtle`, per-status quartets, `--grid-line`, `--slot-open-bg`, `--tag-{1-8}-bg/border/foreground`, `--blocked-hatch-fg/bg`) declared in both `:root` and `.dark`; `--destructive` aliases `--danger`
- [ ] New `lib/theme/oklch.ts` (dependency-free OKLCH parsing + contrast-ratio math); test suite asserts WCAG AA contrast for every declared token pair in both themes
- [ ] `AppShell.tsx` header/background/text visibly flips theme (chrome only — rest of app restyled in later tickets, per staged rollout)
- [ ] Existing `AppShell.test.tsx` stays green; role-nav rendering unaffected

## Brief anchors
- API: None — frontend-only
- UI/wireframe: Theme mechanism is hand-rolled, explicitly NOT `next-themes`. Token ramps copied literally from Tailwind v4's own `theme.css`. `MIN_VISIBLE_HOURS`/tag ramp/status quartet decisions already accepted by prior gate — do not re-litigate.
- Note: this is the one ticket allowed to be foundational per the brief's own staged rollout order (tokens+theme mechanism must exist before shadcn/calendar/wizard/sweep).
