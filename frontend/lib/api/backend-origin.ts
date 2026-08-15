/**
 * Absolute origin of the Django API for *server-side* fetches (Next.js
 * `proxy.ts` calling `GET /auth/me`). This is not the URL the browser
 * talks to — see `API_BASE_URL` and the rewrites in `next.config.ts`.
 *
 * On Railway, `up.railway.app` is a public suffix, so the frontend and
 * backend hosts are different sites. Auth cookies are `SameSite=Strict`,
 * so they only work if the browser talks to one host. The browser therefore
 * calls this Next origin; Next rewrites those paths to Django. Server-side
 * code still needs Django's real origin so it doesn't loop through itself.
 */
export function backendOrigin(): string {
  const explicit = process.env.BACKEND_URL?.replace(/\/$/, "");
  if (explicit) {
    return explicit;
  }
  const railwayBackend = process.env.RAILWAY_SERVICE_BACKEND_URL;
  if (railwayBackend) {
    return `https://${railwayBackend}`;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}
