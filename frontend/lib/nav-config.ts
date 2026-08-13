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
 * screens: `/provider/calendar` (the day-to-day agenda) is the provider's
 * home, so its link is labeled "Dashboard" to match the patient and admin
 * navs, while `/provider` (availability settings) keeps its descriptive
 * "Availability" label.
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
      { label: "Dashboard", href: "/provider/calendar" },
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
