import type { ReactNode } from "react";
import { AppShell } from "@/components/nav/AppShell";

export default function PatientLayout({ children }: { children: ReactNode }) {
  // proxy.ts has already rejected any request that isn't role=patient before
  // this layout renders, so `role="patient"` here is a known fact, not a
  // check.
  return <AppShell role="patient">{children}</AppShell>;
}
