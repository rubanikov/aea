import Link from "next/link";
import { SessionMismatchNotice } from "@/components/auth/SessionMismatchNotice";
import { isRole } from "@/lib/auth/roles";

/**
 * Where `proxy.ts` sends a visit that reached a role-gated route with the
 * wrong role. `?required=` names the role the route wanted (set by the
 * proxy); `SessionMismatchNotice` pairs it with whoever actually holds this
 * browser's session.
 */
export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const required = (await searchParams).required;
  const requiredRole =
    typeof required === "string" && isRole(required) ? required : null;

  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>

      <SessionMismatchNotice requiredRole={requiredRole} />

      <Link href="/login" className="text-sm underline">
        Switch account
      </Link>
    </div>
  );
}
