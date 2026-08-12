"use client";

import { cn } from "@/lib/utils";

/** The four wizard steps, in order. `StepIndicator` owns this vocabulary;
 * `BookingWizard` and `SummaryRail` import it rather than redeclaring. */
export type WizardStepId = "provider" | "service" | "datetime" | "confirm";

export const WIZARD_STEPS: readonly { id: WizardStepId; label: string }[] = [
  { id: "provider", label: "Provider" },
  { id: "service", label: "Service" },
  { id: "datetime", label: "Date & time" },
  { id: "confirm", label: "Confirm" },
];

interface StepIndicatorProps {
  activeStep: WizardStepId;
  completedSteps: ReadonlySet<WizardStepId>;
}

/**
 * The wizard's stepper chrome: Provider → Service → Date & time → Confirm,
 * with the current step marked `aria-current="step"` and completed steps
 * shown with a check (plus visually-hidden "completed" text, so the state
 * is never conveyed by the icon alone). Display-only — navigating back to
 * an earlier step happens through `SummaryRail`'s per-selection "Change"
 * buttons, not by clicking here, so there's exactly one way back and the
 * invalidation rules live in one place (`BookingWizard`).
 */
export function StepIndicator({ activeStep, completedSteps }: StepIndicatorProps) {
  return (
    <ol aria-label="Booking steps" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {WIZARD_STEPS.map((step, index) => {
        const isActive = step.id === activeStep;
        const isCompleted = completedSteps.has(step.id);
        return (
          <li
            key={step.id}
            aria-current={isActive ? "step" : undefined}
            className="flex items-center gap-2 text-sm"
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : isCompleted
                    ? "border-primary-subtle bg-primary-subtle text-primary-subtle-foreground"
                    : "border-border text-muted-foreground"
              )}
            >
              {isCompleted && !isActive ? "✓" : index + 1}
            </span>
            <span
              className={cn(
                isActive ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
            {isCompleted ? <span className="sr-only">(completed)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
