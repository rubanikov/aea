/**
 * Carries the "your session expired" message across the redirect to
 * `/login` triggered when an authenticated fetch gets a 401 outside of the
 * login page itself (see `hooks/use-authenticated-request.ts` and
 * `hooks/use-current-user.ts`).
 */
export const SESSION_EXPIRED_PARAM = "session_expired";

export const SESSION_EXPIRED_MESSAGE =
  "Your session expired — please log in again.";

export function loginPathWithSessionExpired(): string {
  return `/login?${SESSION_EXPIRED_PARAM}=1`;
}

export function readSessionExpiredMessage(
  searchParams: URLSearchParams
): string | null {
  return searchParams.get(SESSION_EXPIRED_PARAM) === "1"
    ? SESSION_EXPIRED_MESSAGE
    : null;
}
