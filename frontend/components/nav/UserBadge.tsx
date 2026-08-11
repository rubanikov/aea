"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { clearMockRole } from "@/lib/auth/mock-session";

/**
 * Nav-corner "who am I" display. Uses `useCurrentUser()` for display only --
 * it never gates anything, since route access is enforced in `proxy.ts`.
 */
export function UserBadge() {
  const user = useCurrentUser();
  const router = useRouter();

  function handleLogout() {
    clearMockRole();
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    return (
      <Link href="/login" className="text-sm font-medium underline">
        Log in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span data-testid="current-user-name">{user.name}</span>
      <span
        data-testid="current-user-role"
        className="capitalize text-gray-500"
      >
        {user.role}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="font-medium underline"
      >
        Log out
      </button>
    </div>
  );
}
