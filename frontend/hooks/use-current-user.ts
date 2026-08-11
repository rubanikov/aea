"use client";

import { useSyncExternalStore } from "react";
import { readMockRole } from "@/lib/auth/mock-session";
import type { Role } from "@/lib/auth/roles";

export interface CurrentUser {
  id: string;
  name: string;
  role: Role;
}

const MOCK_USERS: Record<Role, CurrentUser> = {
  patient: { id: "demo-patient", name: "Pat Patient", role: "patient" },
  provider: {
    id: "demo-provider",
    name: "Dr. Riley Provider",
    role: "provider",
  },
  admin: { id: "demo-admin", name: "Alex Admin", role: "admin" },
};

function subscribe() {
  // The mock role cookie only ever changes through this app's own
  // navigations (login/logout), each of which remounts the relevant tree,
  // so there's no external event to subscribe to here.
  return () => {};
}

function getSnapshot(): Role | null {
  return readMockRole();
}

function getServerSnapshot(): Role | null {
  // The cookie can't be read during server rendering; treat as logged out
  // until the client snapshot takes over post-hydration.
  return null;
}

/**
 * Placeholder "current user" for the nav shell. Returns `null` when logged
 * out, otherwise a mock user matching the visitor's role.
 *
 * TODO(TICKET-02): replace this with a real session lookup once
 * registration/login exists. This reads a demo role cookie (set by the
 * `/login` placeholder page's role switcher), not a real session -- it must
 * never be relied on for access control. Route access is enforced
 * independently and server-side in `proxy.ts`.
 *
 * Uses `useSyncExternalStore` (rather than an effect + setState) since the
 * mock role cookie is external browser state, not React state.
 */
export function useCurrentUser(): CurrentUser | null {
  const role = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return role ? MOCK_USERS[role] : null;
}
