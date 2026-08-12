"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import type { BlockedTime } from "@/lib/availability/types";

const BLOCKED_TIME_PATH = "/scheduling/blocked-time";

/**
 * The provider's full blocked-time history (`GET /scheduling/blocked-time`),
 * fetched ONCE per mount — deliberately not keyed on the visible week,
 * exactly like `useProviderAvailability`. The endpoint takes no query
 * params and returns the same unfiltered list every time, so re-fetching
 * on week navigation would be wasted round-trips for identical data; the
 * caller filters down to the visible week client-side.
 *
 * Failure here must never block the calendar — bookings, profile, and
 * availability all keep working — and must never paint anything AS
 * blocked that isn't confirmed blocked: the failure state is an absence
 * of hatching plus a non-blocking warning whose `retry` re-fires ONLY
 * this fetch.
 */
export function useProviderBlockedTime(): {
  /** `null` while loading or after a failure. */
  blockedTimes: BlockedTime[] | null;
  error: string | null;
  retry: () => void;
} {
  const authFetch = useAuthenticatedRequest();
  const [blockedTimes, setBlockedTimes] = useState<BlockedTime[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<BlockedTime[]>(BLOCKED_TIME_PATH)
      .then((result) => {
        if (!cancelled) {
          setBlockedTimes(result);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (!(err instanceof ApiError && err.status === 401)) {
          setError(
            "Couldn't load your blocked time — the grid may show hours that are actually blocked."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  function retry() {
    setError(null);
    setBlockedTimes(null);
    setReloadKey((key) => key + 1);
  }

  return { blockedTimes, error, retry };
}
