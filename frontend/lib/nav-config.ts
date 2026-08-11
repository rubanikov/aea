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
 * Per-role nav structure for the app shell. Later tickets add real screens
 * here as they land (see `wireframes.html` for what each role's nav
 * eventually needs). The provider role is the first to outgrow a single
 * placeholder link: `/provider` (availability settings, TICKET-04/05/14)
 * and `/provider/calendar` (the day-to-day agenda, TICKET-08) are two
 * separate screens per the wireframe, so "Dashboard" is relabeled to
 * "Availability" here rather than staying a generic name now that there's
 * a second, more frequently-used provider screen to distinguish it from.
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
