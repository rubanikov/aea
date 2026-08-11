import { MOCK_SESSION_COOKIE, isRole, type Role } from "./roles";

/**
 * Client-side read/write helpers for the mock session cookie. These back the
 * `/login` demo role switcher and the nav's "Log out" control -- they exist
 * only so this ticket's nav shell and route guard have something to react
 * to before real authentication lands.
 *
 * TODO(TICKET-02): delete this file once real login sets a real session
 * cookie server-side.
 */

const MOCK_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export function readMockRole(): Role | null {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${MOCK_SESSION_COOKIE}=([^;]*)`)
  );
  const value = match ? decodeURIComponent(match[1]) : null;
  return isRole(value) ? value : null;
}

export function setMockRole(role: Role): void {
  document.cookie = `${MOCK_SESSION_COOKIE}=${role}; path=/; max-age=${MOCK_SESSION_MAX_AGE_SECONDS}; samesite=lax`;
}

export function clearMockRole(): void {
  document.cookie = `${MOCK_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
