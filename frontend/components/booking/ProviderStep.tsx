"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import type { Provider } from "@/lib/scheduling/types";
import { formatTimezone } from "@/lib/timezones";
import { cn } from "@/lib/utils";

interface ProviderStepProps {
  /** The currently selected provider (if the patient came back to change
   * it), so the row reads as selected via `aria-pressed`. */
  selectedProviderId: number | null;
  onSelect: (provider: Provider) => void;
}

const PROVIDERS_PATH = "/scheduling/providers";

/**
 * Wizard step 1: pick a provider from `GET /scheduling/providers`. Each row
 * shows the provider's name and their timezone as a human name
 * (`formatTimezone`), never a raw IANA id. Deliberately no "any available
 * provider" fast-path: with provider chosen first there's no data to
 * support "soonest opening across any provider" without one extra slots
 * request per provider, so it was dropped from this pass.
 */
export function ProviderStep({ selectedProviderId, onSelect }: ProviderStepProps) {
  const authFetch = useAuthenticatedRequest();

  const [providers, setProviders] = useState<Provider[] | null>(null); // null = loading
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<Provider[]>(PROVIDERS_PATH)
      .then((result) => {
        if (!cancelled) {
          setProviders(result);
        }
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        if (!(fetchError instanceof ApiError && fetchError.status === 401)) {
          setError("Couldn't load providers — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  function retry() {
    setError(null);
    setProviders(null);
    setReloadKey((key) => key + 1);
  }

  return (
    <section aria-labelledby="provider-step-heading" className="flex flex-col gap-3">
      <h2 id="provider-step-heading" className="text-lg font-semibold">
        Choose a provider
      </h2>

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
      ) : providers === null ? (
        <p className="text-sm text-muted-foreground">Loading providers…</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No providers are available to book with right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isSelected = provider.id === selectedProviderId;
            return (
              <li key={provider.id}>
                <button
                  type="button"
                  onClick={() => onSelect(provider)}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full rounded-lg border p-4 text-left",
                    isSelected
                      ? "border-primary bg-primary-subtle"
                      : "border-border bg-card hover:border-border-strong hover:bg-accent"
                  )}
                >
                  <span className="block font-medium">{provider.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatTimezone(provider.timezone)}
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
