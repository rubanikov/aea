"use client";

import type { ReactNode } from "react";
import { formatDurationShort } from "@/lib/availability/durations";
import type { AppointmentType } from "@/lib/availability/types";
import { formatAppointmentDateTime } from "@/lib/bookings/format";
import type { Provider, Slot } from "@/lib/scheduling/types";
import { formatTimezone } from "@/lib/timezones";
import type { WizardStepId } from "./StepIndicator";

interface SummaryRailProps {
  provider: Provider | null;
  appointmentType: AppointmentType | null;
  slot: Slot | null;
  /** Browser-detected; `null` while still resolving (pre-hydration). */
  patientTimeZone: string | null;
  /** Jump back to a step to change its value. Omitted entirely (e.g. after
   * the booking has been confirmed) to hide every "Change" button. The
   * button itself never clears anything — only actually picking a
   * *different* value on the revisited step does (see `BookingWizard`'s
   * invalidation rules). */
  onEdit?: (step: WizardStepId) => void;
}

function SummaryItem({
  label,
  editLabel,
  onEdit,
  children,
}: {
  label: string;
  editLabel: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </dt>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={editLabel}
            className="text-xs font-medium text-link underline"
          >
            Change
          </button>
        ) : null}
      </div>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * The persistent "Your selections" rail beside the wizard steps: what's
 * been chosen so far, with a "Change" button per filled-in selection that
 * jumps back to that step.
 *
 * The chosen date/time follows the same dual-clock convention as
 * `TimeSlotGrid`: the provider's zone is the primary label (that's the
 * clock the schedule itself is kept on), with the patient's own local
 * reading underneath only when the two *rendered* strings actually differ
 * — compared as rendered text, not as zone ids, since two different IANA
 * ids can name the same wall clock.
 */
export function SummaryRail({
  provider,
  appointmentType,
  slot,
  patientTimeZone,
  onEdit,
}: SummaryRailProps) {
  const notChosen = <span className="text-muted-foreground">Not chosen yet</span>;

  const providerRange =
    slot && provider ? formatAppointmentDateTime(slot.start, slot.end, provider.timezone) : null;
  const patientRange =
    slot && patientTimeZone
      ? formatAppointmentDateTime(slot.start, slot.end, patientTimeZone)
      : null;
  const showPatientRange = patientRange !== null && patientRange !== providerRange;

  return (
    <aside
      aria-label="Your selections"
      className="h-fit rounded-xl border border-border bg-card p-4 lg:w-72 lg:shrink-0"
    >
      <dl className="flex flex-col gap-4">
        <SummaryItem
          label="Provider"
          editLabel="Change provider"
          onEdit={provider && onEdit ? () => onEdit("provider") : undefined}
        >
          {provider ? (
            <>
              <span className="font-medium">{provider.name}</span>
              <span className="block text-xs text-muted-foreground">
                {formatTimezone(provider.timezone)}
              </span>
            </>
          ) : (
            notChosen
          )}
        </SummaryItem>

        <SummaryItem
          label="Service"
          editLabel="Change service"
          onEdit={appointmentType && onEdit ? () => onEdit("service") : undefined}
        >
          {appointmentType ? (
            <span className="font-medium">
              {appointmentType.name} ({formatDurationShort(appointmentType.duration_minutes)})
            </span>
          ) : (
            notChosen
          )}
        </SummaryItem>

        <SummaryItem
          label="Date & time"
          editLabel="Change date & time"
          onEdit={slot && onEdit ? () => onEdit("datetime") : undefined}
        >
          {providerRange ? (
            <>
              <span className="font-medium">{providerRange}</span>
              {showPatientRange ? (
                <span className="block text-xs text-muted-foreground">
                  {patientRange} your time
                </span>
              ) : null}
            </>
          ) : (
            notChosen
          )}
        </SummaryItem>
      </dl>
    </aside>
  );
}
