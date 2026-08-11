import { ApiError, apiFetch, readJsonBody } from "@/lib/api/client";
import { isRole, type Role } from "./roles";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Calls `GET /auth/me`, the source of truth for "who is logged in and
 * what's their role". Both client components (`useCurrentUser`) and
 * `proxy.ts` (server-side) call this rather than trying to decode any
 * cookie themselves, per the API contract.
 *
 * Resolves to `null` when there is no session (401). Throws `ApiError` for
 * any other non-2xx response (network/backend failure), so callers can
 * distinguish "definitely logged out" from "the request itself failed".
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await apiFetch("/auth/me");

  if (response.status === 401) {
    return null;
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  const data = body as (Omit<Partial<CurrentUser>, "id"> & { id?: unknown }) | null;
  const hasValidId =
    typeof data?.id === "string" || typeof data?.id === "number";
  if (!data || !hasValidId || !isRole(data.role)) {
    return null;
  }

  return {
    // The backend's primary key is a JSON number (Django's default integer
    // PK); normalized to a string here so the rest of the app can keep
    // treating `CurrentUser.id` as an opaque string identifier.
    id: String(data.id),
    email: data.email ?? "",
    name: data.name ?? "",
    role: data.role,
  };
}
