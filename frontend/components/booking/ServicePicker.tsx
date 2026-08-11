"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { formatDurationShort } from "@/lib/availability/durations";
import type { AppointmentType } from "@/lib/availability/types";
import type { Provider } from "@/lib/scheduling/types";

interface ServicePickerProps {
  onSelect: (provider: Provider, appointmentType: AppointmentType) => void;
}

const PROVIDERS_PATH = "/scheduling/providers";

/**
 * Step 1 of the patient booking flow (TICKET-06): pick a provider, then --
 * scoped to that provider -- pick an appointment type. A single in-page
 * selector (state, not a route) so choosing both leads straight into
 * `SlotBrowser` with zero page navigations, per the wireframe's own "book in
 * seconds" reasoning.
 *
 * `GET /scheduling/providers` and `GET /scheduling/providers/:id/appointment-types`
 * are this ticket's two new, assumed endpoints (built in parallel by the
 * backend half) -- there is no existing `backend/scheduling/` route for
 * either yet to confirm shapes against; adapt if the real response differs.
 * `AppointmentType`'s shape itself is already real and shared with the
 * provider's own `GET /scheduling/appointment-types`
 * (`lib/availability/types.ts`).
 */
export function ServicePicker({ onSelect }: ServicePickerProps) {
  const authFetch = useAuthenticatedRequest();

  const [providers, setProviders] = useState<Provider[] | null>(null); // null = loading
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providersReloadKey, setProvidersReloadKey] = useState(0);

  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[] | null>(null); // null = loading
  const [typesError, setTypesError] = useState<string | null>(null);
  const [typesReloadKey, setTypesReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<Provider[]>(PROVIDERS_PATH)
      .then((result) => {
        if (!cancelled) {
          setProviders(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setProvidersError("Couldn't load providers — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, providersReloadKey]);

  useEffect(() => {
    if (selectedProviderId === null) {
      return;
    }
    let cancelled = false;

    authFetch<AppointmentType[]>(`${PROVIDERS_PATH}/${selectedProviderId}/appointment-types`)
      .then((result) => {
        if (!cancelled) {
          setAppointmentTypes(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setTypesError("Couldn't load this provider's appointment types — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, selectedProviderId, typesReloadKey]);

  function retryProviders() {
    setProvidersError(null);
    setProviders(null);
    setProvidersReloadKey((key) => key + 1);
  }

  function retryTypes() {
    setTypesError(null);
    setAppointmentTypes(null);
    setTypesReloadKey((key) => key + 1);
  }

  function selectProvider(providerId: number) {
    setSelectedProviderId(providerId);
    // Reset here, in the click handler, rather than in the fetch effect's
    // body -- the effect's job is to synchronize with the fetch, not to
    // reset state as a side effect of its own; this keeps every setState
    // call there inside a `.then`/`.catch` callback, mirroring every other
    // fetch effect in this codebase (`AppointmentTypesSection`,
    // `BlockedTimeSection`, ...).
    setAppointmentTypes(null);
    setTypesError(null);
  }

  const selectedProvider = providers?.find((provider) => provider.id === selectedProviderId);

  function selectAppointmentType(appointmentType: AppointmentType) {
    if (selectedProvider) {
      onSelect(selectedProvider, appointmentType);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-semibold">1. Choose a provider</legend>

        {providersError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-600">
              {providersError}
            </p>
            <button
              type="button"
              onClick={retryProviders}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        ) : providers === null ? (
          <p className="text-sm text-gray-600">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-gray-600">
            No providers are available to book with right now.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <li key={provider.id}>
                <button
                  type="button"
                  onClick={() => selectProvider(provider.id)}
                  aria-pressed={provider.id === selectedProviderId}
                  className={`rounded border px-4 py-2 text-sm font-medium ${
                    provider.id === selectedProviderId
                      ? "border-black bg-black text-white"
                      : "border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {provider.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {selectedProviderId !== null ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-semibold">2. Choose a service</legend>

          {typesError ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-sm text-red-600">
                {typesError}
              </p>
              <button
                type="button"
                onClick={retryTypes}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Try again
              </button>
            </div>
          ) : appointmentTypes === null ? (
            <p className="text-sm text-gray-600">Loading appointment types…</p>
          ) : appointmentTypes.length === 0 ? (
            <p className="text-sm text-gray-600">
              This provider hasn&apos;t set up any appointment types yet. Try another
              provider.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {appointmentTypes.map((appointmentType) => (
                <li key={appointmentType.id}>
                  <button
                    type="button"
                    onClick={() => selectAppointmentType(appointmentType)}
                    className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
                  >
                    {appointmentType.name} ({formatDurationShort(appointmentType.duration_minutes)})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
