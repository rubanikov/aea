/**
 * Shared role vocabulary for the (currently mocked) auth scaffolding.
 *
 * TODO(TICKET-02): once real registration/login exists, this file should be
 * the only place that needs to keep matching the server's role enum.
 */
export type Role = "patient" | "provider" | "admin";

export const ROLES: readonly Role[] = ["patient", "provider", "admin"];

export function isRole(value: string | null | undefined): value is Role {
  return value === "patient" || value === "provider" || value === "admin";
}

/**
 * Name of the cookie used to fake a session for this ticket's scaffolding.
 * Both `proxy.ts` (route guarding) and the client-side mock session helpers
 * read/write this same cookie, so the nav and the guard always agree.
 *
 * TODO(TICKET-02): replace with the real session cookie name once login
 * exists, and delete `lib/auth/mock-session.ts`.
 */
export const MOCK_SESSION_COOKIE = "demo_role";
