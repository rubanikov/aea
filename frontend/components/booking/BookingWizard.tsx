"use client";

import { useState, type ReactNode } from "react";
import { usePatientTimeZone } from "@/hooks/use-patient-timezone";
import type { AppointmentType } from "@/lib/availability/types";
import type { Booking, Provider, Slot } from "@/lib/scheduling/types";
import { ConfirmStep } from "./ConfirmStep";
import { DateTimeStep } from "./DateTimeStep";
import { ProviderStep } from "./ProviderStep";
import { ServiceStep } from "./ServiceStep";
import { StepIndicator, type WizardStepId } from "./StepIndicator";
import { SummaryRail } from "./SummaryRail";

/**
 * Patient booking entry point: the four-step wizard (Provider → Service →
 * Date & time → Confirm) with the persistent summary rail. All in-page
 * component state, not routes, keeping the whole flow "book in seconds".
 *
 * Invalidation rules — a selection is cleared only when an *upstream*
 * choice actually changes, never by merely navigating back to its step:
 *
 * - Changing the provider clears BOTH the service and the slot (both were
 *   scoped to that provider).
 * - Changing the service clears the slot only (the slot list is fetched
 *   per service).
 * - Changing the date/time clears nothing else.
 * - Re-selecting the *same* provider/service is not a change and clears
 *   nothing.
 *
 * Only the active step is mounted, so each step's fetch state resets
 * naturally on entry — which is also what makes the 409 lost-race path
 * work with no extra plumbing: `handleSlotUnavailable` clears the slot and
 * returns to the Date & time step, whose mount refetches the (now known
 * stale) slot list.
 *
 * `activeStep` is what the user asked for; the rendered step is clamped to
 * the furthest step its prerequisites actually allow, so an inconsistent
 * combination (e.g. Confirm with no slot after an upstream change) is
 * unrepresentable rather than guarded ad hoc in each step.
 */
export function BookingWizard() {
  const patientTimeZone = usePatientTimeZone();

  const [activeStep, setActiveStep] = useState<WizardStepId>("provider");
  const [provider, setProvider] = useState<Provider | null>(null);
  const [appointmentType, setAppointmentType] = useState<AppointmentType | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [completedBooking, setCompletedBooking] = useState<Booking | null>(null);

  const step: WizardStepId = (() => {
    if (activeStep === "confirm" && provider && appointmentType && slot) {
      return "confirm";
    }
    if ((activeStep === "confirm" || activeStep === "datetime") && provider && appointmentType) {
      return "datetime";
    }
    if (activeStep !== "provider" && provider) {
      return "service";
    }
    return "provider";
  })();

  const completedSteps = new Set<WizardStepId>();
  if (provider) {
    completedSteps.add("provider");
  }
  if (appointmentType) {
    completedSteps.add("service");
  }
  if (slot) {
    completedSteps.add("datetime");
  }
  if (completedBooking) {
    completedSteps.add("confirm");
  }

  function handleSelectProvider(nextProvider: Provider) {
    if (provider?.id !== nextProvider.id) {
      setAppointmentType(null);
      setSlot(null);
    }
    setProvider(nextProvider);
    setActiveStep("service");
  }

  function handleSelectService(nextAppointmentType: AppointmentType) {
    if (appointmentType?.id !== nextAppointmentType.id) {
      setSlot(null);
    }
    setAppointmentType(nextAppointmentType);
    setActiveStep("datetime");
  }

  function handleSelectSlot(nextSlot: Slot) {
    setSlot(nextSlot);
    setActiveStep("confirm");
  }

  function handleSlotUnavailable() {
    setSlot(null);
    setActiveStep("datetime");
  }

  function handleStartOver() {
    setCompletedBooking(null);
    setProvider(null);
    setAppointmentType(null);
    setSlot(null);
    setActiveStep("provider");
  }

  let stepContent: ReactNode;
  if (step === "provider") {
    stepContent = (
      <ProviderStep selectedProviderId={provider?.id ?? null} onSelect={handleSelectProvider} />
    );
  } else if (step === "service" && provider) {
    stepContent = (
      <ServiceStep
        provider={provider}
        selectedAppointmentTypeId={appointmentType?.id ?? null}
        onSelect={handleSelectService}
      />
    );
  } else if (!patientTimeZone) {
    // Steps 3 and 4 label every time in two clocks, so they need the
    // browser-detected zone first. Effectively instantaneous in practice (a
    // synchronous browser API read deferred one tick past mount to avoid a
    // server/client hydration mismatch, see `usePatientTimeZone`) — a real,
    // if brief, loading state rather than a silent `?? "UTC"` guess that
    // could mislabel every slot time without any indication.
    stepContent = <p className="text-sm text-muted-foreground">Detecting your timezone…</p>;
  } else if (step === "datetime" && provider && appointmentType) {
    stepContent = (
      <DateTimeStep
        provider={provider}
        appointmentType={appointmentType}
        patientTimeZone={patientTimeZone}
        onSelectSlot={handleSelectSlot}
      />
    );
  } else if (step === "confirm" && provider && appointmentType && slot) {
    stepContent = (
      <ConfirmStep
        provider={provider}
        appointmentType={appointmentType}
        slot={slot}
        patientTimeZone={patientTimeZone}
        onBooked={setCompletedBooking}
        onSlotUnavailable={handleSlotUnavailable}
        onStartOver={handleStartOver}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator activeStep={step} completedSteps={completedSteps} />
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <div className="min-w-0 flex-1">{stepContent}</div>
        <SummaryRail
          provider={provider}
          appointmentType={appointmentType}
          slot={slot}
          patientTimeZone={patientTimeZone}
          // Once the booking is made, the selections are history, not
          // editable state: hide every "Change" button.
          onEdit={completedBooking ? undefined : setActiveStep}
        />
      </div>
    </div>
  );
}
