import type { ReactNode } from "react";
import Link from "next/link";
import { ROLE_NAV } from "@/lib/nav-config";
import type { Role } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { UserBadge } from "./UserBadge";

interface AppShellProps {
  /**
   * The role this shell is for. Callers are each role's own layout
   * (`app/patient/layout.tsx` etc.), so this is a static fact of which
   * layout rendered; `proxy.ts` has already guaranteed only a matching
   * visitor reaches it. It is not read from `useCurrentUser()`, which is
   * mock/display-only and must not drive what's considered "allowed".
   */
  role: Role;
  children: ReactNode;
}

/**
 * Persistent top nav + content area shared by every role section. This is
 * the shape each role's real screens mount into as the nav links list
 * grows.
 */
export function AppShell({ role, children }: AppShellProps) {
  const nav = ROLE_NAV[role];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold">{nav.label} portal</span>
          <nav aria-label={`${nav.label} navigation`}>
            <ul className="flex gap-4 text-sm">
              {nav.links.map((link) => (
                <li key={link.href}>
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-sm font-normal underline"
                  >
                    <Link href={link.href}>{link.label}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <UserBadge />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
