import { apiJson } from "@/lib/api/client";
import { fetchCurrentUser } from "./current-user";
import type { Role } from "./roles";

const ROLE_HOME: Record<Role, string> = {
  patient: "/patient",
  provider: "/provider",
  admin: "/admin",
};

/** Minimal router shape both real `useRouter()` and test doubles satisfy. */
export interface RedirectRouter {
  push(href: string): void;
}

/** `POST /auth/login`. On success the backend sets the httpOnly session cookie. */
export async function loginWithCredentials(
  email: string,
  password: string
): Promise<void> {
  await apiJson("/auth/login", { method: "POST", body: { email, password } });
}

/**
 * Reads the just-established session via `GET /auth/me` and sends the
 * visitor to their role's landing route. Throws if login/register reported
 * success but no session cookie is visible — bouncing back to `/login`
 * with no message is how a cross-site cookie failure used to look.
 */
export async function redirectToRoleHome(router: RedirectRouter): Promise<void> {
  const user = await fetchCurrentUser();
  if (!user) {
    throw new Error("Signed in, but no session was established.");
  }
  router.push(ROLE_HOME[user.role]);
}
