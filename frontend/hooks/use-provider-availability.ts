"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import type { AvailabilityDay } from "@/lib/availability/types";

const AVAILABILITY_PATH = "/scheduling/availability";

/**
 * The provider's full recurring weekly schedule (`GET
 * /scheduling/availability`), fetched ONCE per mount — deliberately not
 * keyed on the visible week. The endpoint takes no date-range params and
 * returns the same recurring rows for any week, so re-fetching on week
 * navigation would be wasted round-trips for identical data.
 *
 * Failure here must never block the calendar: the week grid still renders
 * bounded by the week's bookings alone (see `visibleHourRange`'s
 * fallback), with a non-blocking inline warning whose `retry` re-fires
 * ONLY this fetch — not the profile fetch, not the bookings fetch.
 */
export function useProviderAvailability(): {
  /** `null` while loading or after a failure. */
  availability: AvailabilityDay[] | null;
  error: string | null;
  retry: () => void;
} {
  const authFetch = useAuthenticatedRequest();
  const [availability, setAvailability] = useState<AvailabilityDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<AvailabilityDay[]>(AVAILABILITY_PATH)
      .then((result) => {
        if (!cancelled) {
          setAvailability(result);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (!(err instanceof ApiError && err.status === 401)) {
          setError("Couldn't load your working hours — the grid may not show your full day.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  function retry() {
    setError(null);
    setAvailability(null);
    setReloadKey((key) => key + 1);
  }

  return { availability, error, retry };
}
