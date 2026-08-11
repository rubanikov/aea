"use client";

import { useState } from "react";
import { usePatientTimeZone } from "@/hooks/use-patient-timezone";
import type { AppointmentType } from "@/lib/availability/types";
import type { Provider } from "@/lib/scheduling/types";
import { ServicePicker } from "./ServicePicker";
import { SlotBrowser } from "./SlotBrowser";

interface Selection {
  provider: Provider;
  appointmentType: AppointmentType;
}

/**
 * Patient booking entry point (TICKET-06): an in-page provider + service
 * picker that leads straight into the date/slot browser, with zero full
 * page navigations in between -- `selection` is component state, not a
 * route change, per the wireframe's own "book in seconds" reasoning.
 * Booking itself (the confirm panel + "Confirm booking" action, TICKET-07)
 * lives inside `SlotBrowser`.
 */
export function BookingFlow() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const patientTimeZone = usePatientTimeZone();

  if (!selection) {
    return (
      <ServicePicker
        onSelect={(provider, appointmentType) => setSelection({ provider, appointmentType })}
      />
    );
  }

  if (!patientTimeZone) {
    // Effectively instantaneous in practice (a synchronous browser API read
    // deferred one tick past mount to avoid a server/client hydration
    // mismatch -- see `usePatientTimeZone`) -- a real, if brief, state
    // rather than a silent `?? "UTC"` guess that could mislabel every slot
    // time without any indication.
    return <p className="text-sm text-gray-600">Detecting your timezone…</p>;
  }

  return (
    <SlotBrowser
      provider={selection.provider}
      appointmentType={selection.appointmentType}
      patientTimeZone={patientTimeZone}
      onBack={() => setSelection(null)}
    />
  );
}
