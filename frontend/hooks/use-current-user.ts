"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { loginPathWithSessionExpired } from "@/lib/auth/session-expired";

export type { CurrentUser };

/**
 * Real "current user" lookup -- calls `GET /auth/me` on mount. `undefined`
 * while the request is in flight, `null` once resolved with no session,
 * otherwise the authenticated user.
 *
 * This is used for display only (see `UserBadge`) -- it never gates
 * rendering, since route access is enforced independently and server-side
 * in `proxy.ts`. Every current call site only ever mounts inside a route
 * `proxy.ts` has already confirmed the visitor's session for, so a 401 here
 * means the session died since navigation, not "never logged in" -- this
 * hook treats that as session-expiry and redirects to `/login` with a clear
 * message, the same as any other authenticated fetch failing outside the
 * login page (see `hooks/use-authenticated-request.ts`). That redirect is a
 * UX nicety on top of `proxy.ts`'s enforcement, not a substitute for it.
 */
export function useCurrentUser(): CurrentUser | null | undefined {
  const router = useRouter();
  // Next's real useRouter() is a stable reference, but keep the latest one
  // in a ref (updated post-render, not read during it) rather than an
  // effect dependency -- some test doubles return a fresh object every
  // render, which would otherwise re-fire this effect (and re-fetch) on
  // every state update it causes.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setUser(result);
        if (result === null) {
          routerRef.current.push(loginPathWithSessionExpired());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
