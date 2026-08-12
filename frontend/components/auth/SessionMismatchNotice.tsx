"use client";

import { useCurrentUser } from "@/hooks/use-current-user";
import type { Role } from "@/lib/auth/roles";

const ROLE_NOUN: Record<Role, string> = {
  patient: "patient",
  provider: "provider",
  admin: "admin",
};

/**
 * The body of `/access-denied`. A denial here almost never means "your
 * account lacks a permission" -- every account in this app can reach its own
 * dashboard. It means the browser is signed in as somebody else than the tab
 * expected.
 *
 * Auth rides in an httpOnly cookie (see `backend/accounts/tokens.py`), and a
 * cookie jar belongs to the browser profile, not to a tab. Signing in as a
 * second user in a second tab therefore replaces the first user's session in
 * every tab at once; the first tab only finds out on its next navigation,
 * which is the "access denied" people report. Naming the account that
 * currently holds the session turns that dead end into something the visitor
 * can act on.
 */
export function SessionMismatchNotice({
  requiredRole,
}: {
  requiredRole: Role | null;
}) {
  const user = useCurrentUser();

  return (
    <div className="flex flex-col gap-4 text-sm text-muted-foreground">
      {/* Only this line waits on GET /auth/me. Rendering an identity we
          haven't confirmed -- or blanking the whole explanation until the
          request lands -- would leave the visitor staring at a bare "access
          denied", which is the very thing this notice exists to replace. */}
      {user && (
        <p data-testid="signed-in-as">
          This browser is signed in as{" "}
          <strong className="font-medium text-foreground">{user.name}</strong> (
          {ROLE_NOUN[user.role]}).
        </p>
      )}

      {requiredRole && (
        <p data-testid="required-role">
          That page belongs to a {ROLE_NOUN[requiredRole]} account.
        </p>
      )}

      <p data-testid="multi-tab-explanation">
        Every tab in this browser shares one session, so signing in as another
        person in any tab signs the previous one out everywhere. To use two
        accounts at once, open the second in a private window or a separate
        browser profile.
      </p>
    </div>
  );
}
