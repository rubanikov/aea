import { type Role, isRole } from "./roles";

/**
 * Route prefixes gated by role. A path is gated if it equals the prefix or
 * starts with `${prefix}/`.
 */
const ROLE_ROUTE_PREFIXES: Record<Role, string> = {
  patient: "/patient",
  provider: "/provider",
  admin: "/admin",
};

/**
 * Route prefixes that require *some* authenticated session but aren't tied
 * to one specific role (e.g. account settings, reachable by any role).
 */
const AUTHENTICATED_ROUTE_PREFIXES: readonly string[] = ["/settings"];

export type RouteAccessResult =
  | { allowed: true }
  | { allowed: false; redirectTo: "/login" | "/access-denied" };

function requiredRoleFor(pathname: string): Role | null {
  for (const role of Object.keys(ROLE_ROUTE_PREFIXES) as Role[]) {
    const prefix = ROLE_ROUTE_PREFIXES[role];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return role;
    }
  }
  return null;
}

function requiresAnyAuthenticatedRole(pathname: string): boolean {
  return AUTHENTICATED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Decides whether `pathname` may be visited by a visitor holding `role`.
 * `role` is `null` for an unauthenticated visitor.
 *
 * This is a pure function so the redirect logic can be unit tested without
 * spinning up a request/response cycle; `proxy.ts` is a thin wrapper around
 * it that plugs in the role from the real, server-verified session
 * (`GET /auth/me`).
 */
export function resolveRouteAccess(
  pathname: string,
  role: string | null
): RouteAccessResult {
  const requiredRole = requiredRoleFor(pathname);

  if (requiredRole) {
    if (!role) {
      return { allowed: false, redirectTo: "/login" };
    }
    if (!isRole(role) || role !== requiredRole) {
      return { allowed: false, redirectTo: "/access-denied" };
    }
    return { allowed: true };
  }

  if (requiresAnyAuthenticatedRole(pathname)) {
    if (!role || !isRole(role)) {
      return { allowed: false, redirectTo: "/login" };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
