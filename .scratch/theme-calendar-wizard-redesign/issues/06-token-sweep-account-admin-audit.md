# 06 — Token sweep: account, admin & audit surfaces

**What to build:** Login, registration, settings, account-deletion, admin, and audit-log screens are restyled onto semantic tokens (no hardcoded palette classes remain), verified in both themes, with friendly timezone labels applied to the profile timezone display. No structural or behavioral change.

**Blocked by:** 01 — Theme mechanism (Light/Dark/System) live across the app shell, 02 — shadcn/ui component foundation adopted in shared chrome, 03 — Provider calendar rebuild: Google Classic Grid week view, 04 — Blocked time visualized on the provider calendar grid, 05 — Patient booking wizard: Provider → Service → Date&Time → Confirm

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** None
**Frontend scope:** `components/auth/*` (`AuthPageClient.tsx`, `LoginForm.tsx`, `RegisterForm.tsx`, `SessionMismatchNotice.tsx`), `components/settings/*` (`DeleteAccountSection.tsx`, `PasswordForm.tsx`, `ProfileForm.tsx`), `components/forms/*` (`PasswordField.tsx`, `TextField.tsx`), `components/audit/*` (`AuditLogFilters.tsx`, `AuditLogPagination.tsx`, `AuditLogTable.tsx`, `AuditLogViewer.tsx`), `app/login/page.tsx`, `app/admin/page.tsx`, `app/settings/page.tsx`, `app/access-denied/page.tsx`, `app/page.tsx`

## Acceptance criteria
- [ ] `components/auth/*`, `components/settings/*`, `components/forms/*`, `components/audit/*` all restyled onto semantic tokens
- [ ] `app/login/page.tsx`, `app/admin/page.tsx`, `app/settings/page.tsx`, `app/access-denied/page.tsx`, `app/page.tsx` restyled
- [ ] `ProfileForm.tsx`'s timezone display uses `formatTimezone()` instead of a raw IANA id
- [ ] No hardcoded Tailwind palette classes (`gray-*`, `blue-*`, etc.) remain in this file set
- [ ] No structural/behavioral change — all existing tests in this file set stay green unmodified in intent
- [ ] Manual/automated check in both themes, WCAG AA maintained (tokens already verified in `01`, this just confirms consumption)

## Brief anchors
- API: None — frontend-only
- UI/wireframe: Pure restyle, brief stage 5 (full-app token sweep).
- Note: kept last, and can run in parallel with `07` (disjoint file sets), because tag/status token adjustments discovered while building `03`–`05` should land before the final sweep, per the brief's own rollout order.
