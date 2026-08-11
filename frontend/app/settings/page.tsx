"use client";

import Link from "next/link";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { PasswordForm } from "@/components/settings/PasswordForm";

const ROLE_HOME: Record<string, string> = {
  patient: "/patient",
  provider: "/provider",
  admin: "/admin",
};

/**
 * Account settings: profile view/edit and password update. Reachable by any
 * authenticated role (`proxy.ts` gates `/settings` on "logged in", not a
 * specific role) -- account deletion ("Danger zone") is TICKET-14's scope,
 * not built here.
 */
export default function SettingsPage() {
  const user = useCurrentUser();
  const backHref = user ? (ROLE_HOME[user.role] ?? "/") : "/";

  return (
    <div className="mx-auto flex max-w-lg flex-1 flex-col gap-10 px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Account settings
        </h1>
        <Link href={backHref} className="text-sm underline">
          Back to dashboard
        </Link>
      </div>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Profile
        </h2>
        <ProfileForm />
      </section>

      <section aria-labelledby="password-heading" className="flex flex-col gap-4">
        <h2 id="password-heading" className="text-lg font-semibold">
          Password
        </h2>
        <PasswordForm />
      </section>
    </div>
  );
}
