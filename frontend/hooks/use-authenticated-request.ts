"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  apiJson,
  refreshSession,
  type ApiRequestOptions,
} from "@/lib/api/client";
import { loginPathWithSessionExpired } from "@/lib/auth/session-expired";

/**
 * Returns a `apiJson`-shaped request function for endpoints that require an
 * existing session (`GET /profile`, `PATCH /profile`,
 * `POST /profile/password`, ...). Every page that uses this hook is one
 * `proxy.ts` has already confirmed the visitor's session for at load time.
 *
 * The access-token cookie is short-lived (15 min) by design, so a 401 here
 * doesn't necessarily mean the session is over -- it's tried once against
 * `POST /auth/refresh` and the original request retried before giving up.
 * Only a 401 that survives a refresh attempt redirects to `/login`; without
 * this, any authenticated action would hard-fail every 15 minutes even with
 * a perfectly valid refresh token still outstanding.
 */
export function useAuthenticatedRequest() {
  const router = useRouter();
  // Kept in a ref (updated post-render, not read during it) so the returned
  // function's identity stays stable across renders -- callers put it in
  // effect dependency arrays, and Next's real useRouter() is stable anyway.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  return useCallback(async function authenticatedJson<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    try {
      return await apiJson<T>(path, options);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const refreshed = await refreshSession();
        if (refreshed) {
          try {
            return await apiJson<T>(path, options);
          } catch (retryError) {
            if (retryError instanceof ApiError && retryError.status === 401) {
              routerRef.current.push(loginPathWithSessionExpired());
            }
            throw retryError;
          }
        }
        routerRef.current.push(loginPathWithSessionExpired());
      }
      throw error;
    }
  }, []);
}
