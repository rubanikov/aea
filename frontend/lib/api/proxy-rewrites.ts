/**
 * Same-origin reverse-proxy rules so the browser talks to this Next.js
 * host for API paths, and Next forwards them to Django.
 *
 * Do not rewrite `/admin` — that is the Next.js admin portal, not Django's
 * `/admin/` site.
 */
export function apiProxyRewrites(
  backend: string
): { source: string; destination: string }[] {
  const origin = backend.replace(/\/$/, "");
  return [
    { source: "/auth/:path*", destination: `${origin}/auth/:path*` },
    { source: "/profile", destination: `${origin}/profile` },
    { source: "/profile/:path*", destination: `${origin}/profile/:path*` },
    { source: "/bookings", destination: `${origin}/bookings` },
    { source: "/bookings/:path*", destination: `${origin}/bookings/:path*` },
    { source: "/scheduling/:path*", destination: `${origin}/scheduling/:path*` },
    { source: "/audit-log", destination: `${origin}/audit-log` },
  ];
}
