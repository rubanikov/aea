"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { useProviderAvailability } from "@/hooks/use-provider-availability";
import { useProviderBlockedTime } from "@/hooks/use-provider-blocked-time";
import { ApiError } from "@/lib/api/client";
import { zonedDateKey } from "@/lib/availability/timezone";
import type {
  AvailabilityDay,
  BlockedTime,
  ScheduleGeneration,
} from "@/lib/availability/types";
import { addWeeks, startOfWeek, weekDates } from "@/lib/bookings/week";
import type {
  BookingStatus,
  BookingStatusAction,
  BookingStatusChangeResult,
  CancellationNotification,
  ProviderBooking,
} from "@/lib/bookings/types";

const BOOKINGS_PATH = "/bookings";

export interface CalendarNav {
  /** Monday of the visible week. */
  weekStart: string;
  selectedDay: string;
}

export interface ProviderCalendarData {
  /** The provider's own timezone; `null` while loading. */
  timezone: string | null;
  timezoneError: string | null;
  retryTimezone: () => void;
  /** Today's date key in the provider's zone; `null` until `timezone` loads. */
  todayKey: string | null;
  /** The visible week + selected day; `null` until `timezone` loads. */
  nav: CalendarNav | null;
  /** The visible week's bookings; `null` while loading. */
  bookings: ProviderBooking[] | null;
  bookingsError: string | null;
  retryBookings: () => void;
  availability: AvailabilityDay[] | null;
  current: ScheduleGeneration | null;
  pending: ScheduleGeneration | null;
  availabilityError: string | null;
  retryAvailability: () => void;
  blockedTimes: BlockedTime[] | null;
  blockedTimeError: string | null;
  retryBlockedTime: () => void;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToToday: () => void;
  jumpToDay: (dateKey: string) => void;
  selectDay: (selectedDay: string) => void;
  changeStatus: (
    id: number,
    status: BookingStatusAction,
    cancellationReason?: string
  ) => Promise<BookingStatusChangeResult>;
}

/**
 * Everything `ProviderCalendar` fetches, navigates and mutates, kept out
 * of the component so its render precedence stays readable on its own.
 *
 * `date_from`/`date_to` are "YYYY-MM-DD" dates, matching
 * `GET /scheduling/slots`'s own query param format, and the request is
 * scoped to the authenticated provider with no `provider_id` needed,
 * matching every other "my own" resource in this codebase (e.g.
 * `GET /scheduling/appointment-types`).
 *
 * The provider's own timezone (`GET /profile`, the same pattern
 * `AppointmentTypesSection` established) drives the `date_from`/`date_to`
 * query bounds, which local day each booking is bucketed under, and every
 * time shown on the grid (hour ruler, block positions, block labels) —
 * never the browser's local timezone. Loading it is a genuine blocking
 * prerequisite: without it there's no correct way to bound the
 * `GET /bookings` query or position anything at all.
 *
 * The schedule generations (`useProviderAvailability`) only shape the
 * grid's visible hour range. The fetch is mount-keyed (live + at most one
 * pending change); which generation governs a day is a date comparison,
 * so week navigation does not refetch. Failure never blocks the calendar
 * — the grid falls back to the hours the week's bookings span, with a
 * non-blocking warning banner whose retry re-fires only that one fetch.
 *
 * One-off blocked time (`useProviderBlockedTime`) follows the same
 * mount-keyed, non-blocking pattern: `GET /scheduling/blocked-time` takes
 * no params and returns the full history, so it's fetched once and
 * filtered client-side to the visible week (`blockedTimesInWeek`) on every
 * navigation, then hatched beneath the booking blocks by `TimeGrid`. Its
 * failure shows an absence of hatching plus its own scoped-retry warning,
 * never a false "blocked" region.
 *
 * `nav` (week + selected day) is `null` until the provider explicitly
 * navigates. The "week containing today" default is a pure computation
 * off `timezone` on every render, not a value copied into state via an
 * effect (which would need to call `setState` synchronously inside that
 * effect purely to seed initial state, an anti-pattern this codebase's
 * lint config rejects outright).
 */
export function useProviderCalendarData(): ProviderCalendarData {
  const authFetch = useAuthenticatedRequest();

  const [timezone, setTimezone] = useState<string | null>(null); // null = loading
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneReloadKey, setTimezoneReloadKey] = useState(0);

  const [nav, setNav] = useState<CalendarNav | null>(null);

  const [bookings, setBookings] = useState<ProviderBooking[] | null>(null); // null = loading
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [bookingsReloadKey, setBookingsReloadKey] = useState(0);

  const {
    availability,
    current,
    pending,
    error: availabilityError,
    retry: retryAvailability,
  } = useProviderAvailability();

  const {
    blockedTimes,
    error: blockedTimeError,
    retry: retryBlockedTime,
  } = useProviderBlockedTime();

  const todayKey = timezone ? zonedDateKey(new Date().toISOString(), timezone) : null;
  const effectiveNav: CalendarNav | null =
    nav ?? (todayKey ? { weekStart: startOfWeek(todayKey), selectedDay: todayKey } : null);
  // Pulled out as its own primitive so the bookings-fetch effect below can
  // depend on it directly. Depending on `effectiveNav` itself would
  // refetch on every same-week day selection too (it also changes then),
  // not just on an actual week change.
  const weekStart = effectiveNav?.weekStart ?? null;

  useEffect(() => {
    let cancelled = false;

    authFetch<{ timezone: string }>("/profile")
      .then((result) => {
        if (!cancelled) {
          setTimezone(result.timezone);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setTimezoneError("Couldn't load your calendar — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, timezoneReloadKey]);

  useEffect(() => {
    if (!timezone || !weekStart) {
      return;
    }
    let cancelled = false;
    const days = weekDates(weekStart);
    const dateFrom = days[0];
    const dateTo = days[days.length - 1];

    authFetch<ProviderBooking[]>(`${BOOKINGS_PATH}?date_from=${dateFrom}&date_to=${dateTo}`)
      .then((result) => {
        if (!cancelled) {
          setBookings(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setBookingsError("Couldn't load your appointments — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, timezone, weekStart, bookingsReloadKey]);

  function retryTimezone() {
    setTimezoneError(null);
    setTimezone(null);
    setTimezoneReloadKey((key) => key + 1);
  }

  function retryBookings() {
    setBookingsError(null);
    setBookings(null);
    setBookingsReloadKey((key) => key + 1);
  }

  /** Shared by prev/next/Today/mini-month: clears the currently-loaded
   * week (the fetch effect above re-fires for the new `weekStart`) and
   * moves the selected day along with it. Mirrors `DateTimeStep`'s
   * week navigation, which resets its own selected date the same way. Deliberately does NOT touch the schedule fetch: live +
   * pending generations are already in memory, and which one governs a
   * day is a date comparison (see `generationWindowsInRange`). */
  function goToWeek(weekStart: string, selectedDay: string) {
    setBookings(null);
    setBookingsError(null);
    setNav({ weekStart, selectedDay });
  }

  function goToPrevWeek() {
    if (effectiveNav) {
      const weekStart = addWeeks(effectiveNav.weekStart, -1);
      goToWeek(weekStart, weekStart);
    }
  }

  function goToNextWeek() {
    if (effectiveNav) {
      const weekStart = addWeeks(effectiveNav.weekStart, 1);
      goToWeek(weekStart, weekStart);
    }
  }

  function goToToday() {
    if (todayKey) {
      goToWeek(startOfWeek(todayKey), todayKey);
    }
  }

  /** Mini-month click: jump the grid to that day's week. Selecting a day
   * already inside the visible week is still routed through `goToWeek`
   * (same week, so the refetch is for the same range) to keep one code
   * path; the selected day matters only to the narrow-screen agenda. */
  function jumpToDay(dateKey: string) {
    goToWeek(startOfWeek(dateKey), dateKey);
  }

  /** Selecting a different day within the *same* week (narrow-screen
   * agenda only): only the filter changes, so this deliberately doesn't
   * clear or re-fetch `bookings`. */
  function selectDay(selectedDay: string) {
    if (effectiveNav) {
      setNav({ weekStart: effectiveNav.weekStart, selectedDay });
    }
  }

  async function changeStatus(
    id: number,
    status: BookingStatusAction,
    cancellationReason?: string
  ): Promise<BookingStatusChangeResult> {
    // `PATCH /bookings/:id/status` returns Booking's canonical serializer
    // shape ({id, provider_id, patient_id, appointment_type_id, start_time,
    // end_time, status}, plus `cancellation_reason` on a cancel) -- it does
    // NOT include the display-only `patient_name`/`appointment_type_name`
    // fields `GET /bookings` adds. Replacing a row wholesale with this
    // response would blank those two fields in the UI on every status
    // change, so only the fields that actually changed (`status`, and
    // `cancellation_reason` when the response carries one) are merged onto
    // the row already held in state -- everything else about the row is
    // unaffected by this call. `notification` (present only on a
    // successful cancel) is transient response data, not row state: it's
    // handed back to the calling row/popover for its email-warning
    // display, never merged into `bookings`.
    const updated = await authFetch<{
      status: BookingStatus;
      cancellation_reason?: string;
      notification?: CancellationNotification;
    }>(`${BOOKINGS_PATH}/${id}/status`, {
      method: "PATCH",
      body:
        cancellationReason === undefined
          ? { status }
          : { status, cancellation_reason: cancellationReason },
    });
    let merged: ProviderBooking | undefined;
    setBookings((current) =>
      (current ?? []).map((booking) => {
        if (booking.id !== id) {
          return booking;
        }
        merged = {
          ...booking,
          status: updated.status,
          ...(typeof updated.cancellation_reason === "string"
            ? { cancellation_reason: updated.cancellation_reason }
            : {}),
        };
        return merged;
      })
    );
    // `merged` is always set by the map above when `id` is a row already in
    // state, which is the only way this function is ever called (from a
    // button rendered for an existing row) -- falling back to a
    // status-only-patched copy of nothing would be worse than a loud crash
    // if that invariant is ever violated, so this intentionally throws
    // rather than silently returning a bogus value.
    if (!merged) {
      throw new Error(`changeStatus: booking ${id} not found in current state`);
    }
    return { booking: merged, notification: updated.notification };
  }

  return {
    timezone,
    timezoneError,
    retryTimezone,
    todayKey,
    nav: effectiveNav,
    bookings,
    bookingsError,
    retryBookings,
    availability,
    current,
    pending,
    availabilityError,
    retryAvailability,
    blockedTimes,
    blockedTimeError,
    retryBlockedTime,
    goToPrevWeek,
    goToNextWeek,
    goToToday,
    jumpToDay,
    selectDay,
    changeStatus,
  };
}
