"use client";

import { AppointmentTypesSection } from "@/components/availability/AppointmentTypesSection";
import { BlockedTimeSection } from "@/components/availability/BlockedTimeSection";
import { WorkingHoursSection } from "@/components/availability/WorkingHoursSection";

/**
 * Provider availability settings (TICKET-04/TICKET-05, frontend half):
 * appointment types (name + duration), weekly working hours, and one-off
 * blocked time -- all required or usable before a provider is really
 * "bookable" (enforced by later tickets, not here). See `architecture.md`
 * §2 and the approved wireframe, Screens 5-6.
 */
export default function ProviderAvailabilityPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Availability settings
      </h1>
      <AppointmentTypesSection />
      <WorkingHoursSection />
      <BlockedTimeSection />
    </div>
  );
}
