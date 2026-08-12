"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { apiFetch } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Nav-corner "who am I" display. Uses `useCurrentUser()` for display only;
 * it never gates anything, since route access is enforced in `proxy.ts`.
 */
export function UserBadge() {
  const user = useCurrentUser();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    // A failed logout request (network blip) shouldn't strand the visitor
    // on a page that thinks they're logged in. Navigate away regardless;
    // the httpOnly cookie will simply outlive this particular request.
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  if (user === undefined) {
    // Loading: avoid flashing a "Log in" link while GET /auth/me is in
    // flight on a page proxy.ts has already confirmed is authenticated.
    return null;
  }

  if (user === null) {
    return (
      <Button asChild variant="link" size="sm" className="h-auto p-0 text-sm">
        <Link href="/login">Log in</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span data-testid="current-user-name">{user.name}</span>
      <Badge
        variant="secondary"
        className="capitalize"
        data-testid="current-user-role"
      >
        {user.role}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        disabled={loggingOut}
        className="h-auto px-2 py-1"
      >
        {loggingOut ? "Logging out…" : "Log out"}
      </Button>
    </div>
  );
}
