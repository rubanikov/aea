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
 * Per-role nav structure for the app shell. The provider role has two
 * screens, `/provider` (availability settings) and `/provider/calendar`
 * (the day-to-day agenda), so its dashboard link is labeled "Availability"
 * rather than a generic "Dashboard", to distinguish it from the more
 * frequently-used calendar screen.
 */
export const ROLE_NAV: Record<Role, RoleNavConfig> = {
  patient: {
    label: "Patient",
    links: [
      { label: "Dashboard", href: "/patient" },
      { label: "My Appointments", href: "/patient/appointments" },
      { label: "Settings", href: "/settings" },
    ],
  },
  provider: {
    label: "Provider",
    links: [
      { label: "Calendar", href: "/provider/calendar" },
      { label: "Availability", href: "/provider" },
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
