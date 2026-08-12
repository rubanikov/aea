import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the ticket-07 token sweep: every file migrated to the
 * semantic token system in `app/globals.css` must stay migrated. A hardcoded
 * Tailwind palette utility (`bg-gray-50`, `text-red-600`, `border-gray-300`,
 * `bg-black`, …) creeping back in would silently break dark mode, because
 * only the semantic tokens flip with the `.dark` class.
 *
 * Alpha-suffixed utilities (`bg-black/50`) are excluded: they are overlay
 * scrims, deliberately theme-independent (the same exclusion
 * `theme-contrast.test.ts` makes).
 *
 * Scoped to this ticket's file list rather than all of `app`/`components`,
 * because other surfaces were migrated by sibling tickets with their own
 * ownership; fold the lists together once every sweep has landed.
 */

const FRONTEND_ROOT = process.cwd();

const MIGRATED_FILES = [
  "components/availability/AppointmentTypeForm.tsx",
  "components/availability/AppointmentTypeRow.tsx",
  "components/availability/AppointmentTypesSection.tsx",
  "components/availability/BlockedTimeForm.tsx",
  "components/availability/BlockedTimeRow.tsx",
  "components/availability/BlockedTimeSection.tsx",
  "components/availability/CollisionWarningModal.tsx",
  "components/availability/DurationSelect.tsx",
  "components/availability/WorkingHoursSection.tsx",
  "components/bookings/RescheduleDialog.tsx",
  "components/bookings/AppointmentCard.tsx",
  "components/bookings/AppointmentTabs.tsx",
  "components/bookings/BookingStatusBadge.tsx",
  "components/bookings/PatientAppointments.tsx",
  "app/patient/appointments/page.tsx",
  "app/patient/page.tsx",
  "app/provider/page.tsx",
];

/** A fixed-palette Tailwind color utility, with or without a variant prefix
 * (`hover:`, `focus:`, …), but not alpha-suffixed (`bg-black/50` is a
 * scrim). `border-border`, `text-foreground`, etc. don't match because the
 * segment after the prefix must be a palette color name. */
const HARDCODED_PALETTE =
  /(?<![\w-])(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?![\w/-])/g;

describe("token migration (ticket 07 surfaces)", () => {
  it.each(MIGRATED_FILES)(
    "%s contains no hardcoded Tailwind palette utility",
    (file) => {
      const source = readFileSync(join(FRONTEND_ROOT, file), "utf8");
      expect(source.match(HARDCODED_PALETTE) ?? []).toEqual([]);
    }
  );
});
