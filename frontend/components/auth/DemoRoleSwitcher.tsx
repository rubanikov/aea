"use client";

import { useRouter } from "next/navigation";
import { ROLES, type Role } from "@/lib/auth/roles";
import { setMockRole } from "@/lib/auth/mock-session";

const ROLE_HOME: Record<Role, string> = {
  patient: "/patient",
  provider: "/provider",
  admin: "/admin",
};

/**
 * Stand-in for real login. Sets the mock session cookie to the chosen role
 * and sends the visitor to that role's home, so the route guard and nav
 * shell built in this ticket have something real to demonstrate against.
 *
 * TODO(TICKET-02): delete this component once real registration/login
 * exists.
 */
export function DemoRoleSwitcher() {
  const router = useRouter();

  function continueAs(role: Role) {
    setMockRole(role);
    router.push(ROLE_HOME[role]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        Real registration and login ship in TICKET-02. Until then, pick a
        role to preview its dashboard and nav.
      </p>
      <div className="flex gap-3">
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => continueAs(role)}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium capitalize hover:bg-gray-50"
          >
            Continue as {role}
          </button>
        ))}
      </div>
    </div>
  );
}
