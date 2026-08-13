"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import type {
  AvailabilityDay,
  ProviderSchedule,
  ScheduleGeneration,
} from "@/lib/availability/types";

const SCHEDULE_PATH = "/scheduling/schedule";

function windowsAsAvailability(
  generation: ScheduleGeneration | null
): AvailabilityDay[] | null {
  if (generation === null) {
    return null;
  }
  return generation.windows.map((window) => ({
    id: window.id,
    day_of_week: window.day_of_week,
    start_time: window.start_time,
    end_time: window.end_time,
    effective_from: generation.effective_from,
  }));
}

/**
 * The provider's schedule generations (`GET /scheduling/schedule`),
 * fetched ONCE per mount — not keyed on the visible week. The payload
 * is the live hours plus at most one pending change; which generation
 * governs a given day is a client-side date comparison, so week
 * navigation does not need a refetch.
 *
 * Failure here must never block the calendar: the week grid still renders
 * bounded by the week's bookings alone (see `visibleHourRange`'s
 * fallback), with a non-blocking inline warning whose `retry` re-fires
 * ONLY this fetch — not the profile fetch, not the bookings fetch.
 */
export function useProviderAvailability(): {
  /** Live generation windows, `null` while loading or after a failure. */
  availability: AvailabilityDay[] | null;
  current: ScheduleGeneration | null;
  pending: ScheduleGeneration | null;
  error: string | null;
  retry: () => void;
} {
  const authFetch = useAuthenticatedRequest();
  const [schedule, setSchedule] = useState<ProviderSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    authFetch<ProviderSchedule>(SCHEDULE_PATH)
      .then((result) => {
        if (!cancelled) {
          setSchedule(result);
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
    setSchedule(null);
    setReloadKey((key) => key + 1);
  }

  return {
    availability: windowsAsAvailability(schedule?.current ?? null),
    current: schedule?.current ?? null,
    pending: schedule?.pending ?? null,
    error,
    retry,
  };
}
