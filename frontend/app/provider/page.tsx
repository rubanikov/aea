"use client";

import { AppointmentTypesSection } from "@/components/availability/AppointmentTypesSection";
import { WorkingHoursSection } from "@/components/availability/WorkingHoursSection";

/**
 * Provider availability settings (TICKET-04, frontend half): appointment
 * types (name + duration) and weekly working hours -- both required before
 * a provider is really "bookable" (enforced by later tickets, not here).
 * See `architecture.md` §2 and the approved wireframe, Screen 5.
 */
export default function ProviderAvailabilityPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Availability settings
      </h1>
      <AppointmentTypesSection />
      <WorkingHoursSection />
    </div>
  );
}
