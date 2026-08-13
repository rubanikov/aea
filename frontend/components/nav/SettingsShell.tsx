"use client";

import type { ReactNode } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isRole, type Role } from "@/lib/auth/roles";
import { AppShell } from "./AppShell";

/**
 * Shell for the shared `/settings` route, which any authenticated role can
 * reach (`proxy.ts` gates it on "logged in", not a specific role). Unlike
 * the per-role layouts, which role's nav to show isn't a static fact of
 * which layout rendered, so it's resolved from `useCurrentUser()` —
 * display-only, never gating access. While the lookup is in flight,
 * AppShell gets `null` and renders its neutral loading header instead of
 * flashing the wrong role's nav. A missing or unrecognized role falls back
 * to the patient nav (providers and admins are always explicitly
 * assigned, so "unknown" is treated as patient).
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const user = useCurrentUser();

  let role: Role | null;
  if (user === undefined) {
    role = null;
  } else if (user !== null && isRole(user.role)) {
    role = user.role;
  } else {
    role = "patient";
  }

  return <AppShell role={role}>{children}</AppShell>;
}
