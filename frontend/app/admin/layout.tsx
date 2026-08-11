import type { ReactNode } from "react";
import { AppShell } from "@/components/nav/AppShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  // proxy.ts has already rejected any request that isn't role=admin before
  // this layout renders, so `role="admin"` here is a known fact, not a
  // check.
  return <AppShell role="admin">{children}</AppShell>;
}
