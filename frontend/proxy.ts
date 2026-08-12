import { NextResponse, type NextRequest } from "next/server";
import { API_BASE_URL } from "./lib/api/client";
import { isRole } from "./lib/auth/roles";
import { resolveRouteAccess } from "./lib/auth/route-guard";

/**
 * Role-gated route guard. Runs on the server before `/patient`, `/provider`,
 * `/admin`, and `/settings` routes render, so an unauthenticated or
 * wrong-role visit is redirected rather than rendered. This is real,
 * request-time enforcement, not client-side nav hiding.
 *
 * Determines the visitor's role by calling `GET /auth/me` server-side,
 * forwarding the incoming request's cookies, the same source of truth
 * client components use (`useCurrentUser`), never a cookie decoded locally.
 */
export async function proxy(request: NextRequest) {
  const role = await fetchRoleForRequest(request);
  const result = resolveRouteAccess(request.nextUrl.pathname, role);

  if (!result.allowed) {
    const destination = new URL(result.redirectTo, request.url);
    if (result.redirectTo === "/access-denied") {
      // A wrong-role visit is usually a replaced session, not an
      // under-privileged account: one browser profile holds one auth cookie,
      // so signing in as a second user anywhere -- another tab included --
      // takes the session over everywhere. Pass along what the route wanted
      // so the denial page can explain that instead of blaming the account.
      destination.searchParams.set("required", result.requiredRole);
    }
    return NextResponse.redirect(destination);
  }

  return NextResponse.next();
}

/**
 * Looks up the requesting visitor's role via `GET /auth/me`, forwarding
 * whatever cookies arrived on the incoming request (the httpOnly session
 * cookie is opaque to this code; the backend is the only thing that can
 * verify it). Returns `null` for "no session" *and* for any failure to
 * reach the backend, so a down/unreachable auth service fails closed
 * (rejects the visit) rather than open.
 */
async function fetchRoleForRequest(request: NextRequest): Promise<string | null> {
  const cookie = request.headers.get("cookie");

  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: cookie ? { cookie } : undefined,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { role?: unknown };
    return typeof data.role === "string" && isRole(data.role)
      ? data.role
      : null;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/patient/:path*", "/provider/:path*", "/admin/:path*", "/settings/:path*"],
};
