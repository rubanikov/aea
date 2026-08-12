"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { formatDurationShort } from "@/lib/availability/durations";
import type { AppointmentType } from "@/lib/availability/types";
import type { Provider } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

interface ServiceStepProps {
  /** The provider chosen in step 1; the appointment-type list is scoped to
   * them. */
  provider: Provider;
  selectedAppointmentTypeId: number | null;
  onSelect: (appointmentType: AppointmentType) => void;
}

const PROVIDERS_PATH = "/scheduling/providers";

/**
 * Wizard step 2: pick a service, scoped to the chosen provider via
 * `GET /scheduling/providers/:id/appointment-types` (the same endpoint the
 * retired `ServicePicker` used; only which step fires it moved).
 * `AppointmentType`'s shape is shared with the provider's own
 * `GET /scheduling/appointment-types` (`lib/availability/types.ts`). An
 * empty list is a real, valid response — a provider who hasn't configured
 * any types yet — and gets its own copy, not an error.
 */
export function ServiceStep({
  provider,
  selectedAppointmentTypeId,
  onSelect,
}: ServiceStepProps) {
  const authFetch = useAuthenticatedRequest();

  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[] | null>(null); // null = loading
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<AppointmentType[]>(`${PROVIDERS_PATH}/${provider.id}/appointment-types`)
      .then((result) => {
        if (!cancelled) {
          setAppointmentTypes(result);
        }
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        if (!(fetchError instanceof ApiError && fetchError.status === 401)) {
          setError("Couldn't load this provider's appointment types — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, provider.id, reloadKey]);

  function retry() {
    setError(null);
    setAppointmentTypes(null);
    setReloadKey((key) => key + 1);
  }

  return (
    <section aria-labelledby="service-step-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="service-step-heading" className="text-lg font-semibold">
          Choose a service
        </h2>
        <p className="text-sm text-muted-foreground">with {provider.name}</p>
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      ) : appointmentTypes === null ? (
        <p className="text-sm text-muted-foreground">Loading appointment types…</p>
      ) : appointmentTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This provider hasn&apos;t set up any appointment types yet. Try another
          provider.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {appointmentTypes.map((appointmentType) => {
            const isSelected = appointmentType.id === selectedAppointmentTypeId;
            return (
              <li key={appointmentType.id}>
                <button
                  type="button"
                  onClick={() => onSelect(appointmentType)}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full rounded-lg border p-4 text-left",
                    isSelected
                      ? "border-primary bg-primary-subtle"
                      : "border-border bg-card hover:border-border-strong hover:bg-accent"
                  )}
                >
                  <span className="block font-medium">{appointmentType.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDurationShort(appointmentType.duration_minutes)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
