import type { Role } from "./auth/roles";

export interface NavLink {
  label: string;
  href: string;
}

export interface RoleNavConfig {
  /** Human-readable label shown in the shell, e.g. in the header. */
  label: string;
  links: NavLink[];
}

/**
 * Per-role nav structure for the app shell. Deliberately minimal -- each
 * role only has a placeholder dashboard today. Later tickets add real
 * screens here as they land (see `wireframes.html` for what each role's
 * nav eventually needs).
 */
export const ROLE_NAV: Record<Role, RoleNavConfig> = {
  patient: {
    label: "Patient",
    links: [
      { label: "Dashboard", href: "/patient" },
      { label: "Settings", href: "/settings" },
    ],
  },
  provider: {
    label: "Provider",
    links: [
      { label: "Dashboard", href: "/provider" },
      { label: "Settings", href: "/settings" },
    ],
  },
  admin: {
    label: "Admin",
    links: [
      { label: "Dashboard", href: "/admin" },
      { label: "Settings", href: "/settings" },
    ],
  },
};
