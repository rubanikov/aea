import type { ReactNode } from "react";
import Link from "next/link";
import { ROLE_NAV } from "@/lib/nav-config";
import type { Role } from "@/lib/auth/roles";
import { UserBadge } from "./UserBadge";

interface AppShellProps {
  /**
   * The role this shell is for. Callers are each role's own layout
   * (`app/patient/layout.tsx` etc.), so this is a static fact of which
   * layout rendered -- `proxy.ts` has already guaranteed only a matching
   * visitor reaches it. It is not read from `useCurrentUser()`, which is
   * mock/display-only and must not drive what's considered "allowed".
   */
  role: Role;
  children: ReactNode;
}

/**
 * Persistent top nav + content area shared by every role section. This is
 * the "shape" later tickets mount their real screens into -- the nav links
 * list will grow as those tickets add routes.
 */
export function AppShell({ role, children }: AppShellProps) {
  const nav = ROLE_NAV[role];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold">{nav.label} portal</span>
          <nav aria-label={`${nav.label} navigation`}>
            <ul className="flex gap-4 text-sm">
              {nav.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <UserBadge />
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
