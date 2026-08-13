"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_NAV } from "@/lib/nav-config";
import type { Role } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { UserBadge } from "./UserBadge";

interface AppShellProps {
  /**
   * Which role's nav to render, or `null` while the role is still being
   * resolved. Role layouts (`app/patient/layout.tsx` etc.) pass a static
   * role — `proxy.ts` has already guaranteed only a matching visitor
   * reaches them. The shared `/settings` route passes the role resolved by
   * `SettingsShell` (from `useCurrentUser()`), or `null` while that lookup
   * is in flight. Either way the role only picks which links to *show*; it
   * never gates access — `proxy.ts` enforces that server-side.
   */
  role: Role | null;
  children: ReactNode;
}

/**
 * Persistent top nav + content area shared by every role section. This is
 * the shape each role's real screens mount into as the nav links list
 * grows. With `role={null}` it renders a neutral loading header: full
 * height (no layout shift when the links appear) but no portal label and
 * no nav links, so one role's menu is never flashed at another role's
 * user.
 */
export function AppShell({ role, children }: AppShellProps) {
  const pathname = usePathname();
  const nav = role === null ? null : ROLE_NAV[role];

  return (
    <div className="flex min-h-full flex-col">
      <header
        aria-busy={nav === null || undefined}
        className="flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-4"
      >
        <div className="flex items-center gap-6">
          {nav === null ? (
            <span
              aria-hidden="true"
              className="inline-block h-6 w-32 rounded bg-muted"
            />
          ) : (
            <>
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
                        <Link
                          href={link.href}
                          aria-current={
                            pathname === link.href ? "page" : undefined
                          }
                        >
                          {link.label}
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </nav>
            </>
          )}
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
