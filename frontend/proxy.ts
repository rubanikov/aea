import { NextResponse, type NextRequest } from "next/server";
import { MOCK_SESSION_COOKIE } from "./lib/auth/roles";
import { resolveRouteAccess } from "./lib/auth/route-guard";

/**
 * Role-gated route guard. Runs on the server before `/patient`, `/provider`,
 * and `/admin` routes render, so an unauthenticated or wrong-role visit is
 * redirected rather than rendered -- this is real, request-time enforcement,
 * not client-side nav hiding.
 *
 * TODO(TICKET-02): read the real, server-verified session instead of this
 * mock cookie once registration/login exists. The redirect logic itself
 * (`resolveRouteAccess`) should not need to change.
 */
export function proxy(request: NextRequest) {
  const role = request.cookies.get(MOCK_SESSION_COOKIE)?.value ?? null;
  const result = resolveRouteAccess(request.nextUrl.pathname, role);

  if (!result.allowed) {
    return NextResponse.redirect(new URL(result.redirectTo, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/patient/:path*", "/provider/:path*", "/admin/:path*"],
};
