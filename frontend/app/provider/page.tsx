"use client";

import { AppointmentTypesSection } from "@/components/availability/AppointmentTypesSection";
import { BlockedTimeSection } from "@/components/availability/BlockedTimeSection";
import { WorkingHoursSection } from "@/components/availability/WorkingHoursSection";

/**
 * Provider availability settings: appointment types (a name plus a
 * chosen 30- or 60-minute slot length),
 * weekly working hours, and one-off blocked time, all required before a
 * provider is really "bookable".
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
