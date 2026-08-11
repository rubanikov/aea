import type { ReactNode } from "react";
import { AppShell } from "@/components/nav/AppShell";

export default function ProviderLayout({
  children,
}: {
  children: ReactNode;
}) {
  // proxy.ts has already rejected any request that isn't role=provider
  // before this layout renders, so `role="provider"` here is a known fact,
  // not a check.
  return <AppShell role="provider">{children}</AppShell>;
}
