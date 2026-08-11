"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { zonedDateKey } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { addWeeks, startOfWeek, weekDates } from "@/lib/bookings/week";
import type { BookingStatus, BookingStatusAction, ProviderBooking } from "@/lib/bookings/types";
import { DayAgenda } from "./DayAgenda";
import { WeekStrip } from "./WeekStrip";

const BOOKINGS_PATH = "/bookings";

interface Nav {
  /** Monday of the visible week. */
  weekStart: string;
  selectedDay: string;
}

function groupByDay(
  bookings: readonly ProviderBooking[],
  timezone: string
): Map<string, ProviderBooking[]> {
  const grouped = new Map<string, ProviderBooking[]>();
  for (const booking of bookings) {
    const key = zonedDateKey(booking.start_time, timezone);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(booking);
    } else {
      grouped.set(key, [booking]);
    }
  }
  for (const dayBookings of grouped.values()) {
    dayBookings.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return grouped;
}

/**
 * Provider's own calendar (TICKET-08, frontend half; see `wireframes.html`
 * Screen 8): a Monday-first week-strip with per-day appointment counts,
 * plus a day-grouped agenda list underneath for whichever day is selected.
 * Role-appropriate status actions only -- mark completed, mark no-show,
 * cancel -- and deliberately no confirm/decline action anywhere: every
 * booking this screen shows already arrived pre-confirmed (TICKET-07's
 * auto-accept).
 *
 * Neither `GET /bookings?date_from=&date_to=` nor `PATCH
 * /bookings/:id/status` exist in `backend/bookings/` yet as of this
 * ticket -- only `POST /bookings` does -- so both are called exactly per
 * the brief's assumed contract: `date_from`/`date_to` as "YYYY-MM-DD"
 * dates (matching `GET /scheduling/slots`'s own query param format), and
 * scoped to the authenticated provider with no `provider_id` needed
 * (matching every other "my own" resource in this codebase, e.g.
 * `GET /scheduling/appointment-types`). Adapt once the real endpoints
 * exist; note any drift.
 *
 * The provider's own timezone (`GET /profile`, the same pattern
 * `AppointmentTypesSection` established) drives both the `date_from`/
 * `date_to` query bounds and which local day each returned booking is
 * grouped under -- this is the provider viewing their own calendar, so
 * their own timezone is what's correct here, never the patient's or a bare
 * UTC display. Loading it is treated as a genuine blocking prerequisite
 * (unlike `AppointmentTypesSection`'s read-only timezone line, which is
 * decorative): without it there's no correct way to bound the `GET
 * /bookings` query or bucket results by day at all.
 *
 * `nav` (week + selected day) is `null` until the provider explicitly
 * navigates -- the "week containing today" default is a pure computation
 * off `timezone` on every render, not a value copied into state via an
 * effect (which would need to call `setState` synchronously inside that
 * effect purely to seed initial state, an anti-pattern this codebase's
 * lint config rejects outright).
 */
export function ProviderCalendar() {
  const authFetch = useAuthenticatedRequest();

  const [timezone, setTimezone] = useState<string | null>(null); // null = loading
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneReloadKey, setTimezoneReloadKey] = useState(0);

  const [nav, setNav] = useState<Nav | null>(null);

  const [bookings, setBookings] = useState<ProviderBooking[] | null>(null); // null = loading
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [bookingsReloadKey, setBookingsReloadKey] = useState(0);

  const todayKey = timezone ? zonedDateKey(new Date().toISOString(), timezone) : null;
  const effectiveNav: Nav | null =
    nav ?? (todayKey ? { weekStart: startOfWeek(todayKey), selectedDay: todayKey } : null);
  // Pulled out as its own primitive so the bookings-fetch effect below can
  // depend on it directly -- depending on `effectiveNav` itself would
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

  /** Shared by prev/next/Today: clears the currently-loaded week (the fetch
   * effect above re-fires for the new `weekStart`) and moves the selected
   * day along with it -- mirrors `SlotBrowser`'s `goToMonth`, which resets
   * its own selected date the same way on month navigation. */
  function goToWeek(weekStart: string, selectedDay: string) {
    setBookings(null);
    setBookingsError(null);
    setNav({ weekStart, selectedDay });
  }

  function handlePrevWeek() {
    if (effectiveNav) {
      const weekStart = addWeeks(effectiveNav.weekStart, -1);
      goToWeek(weekStart, weekStart);
    }
  }

  function handleNextWeek() {
    if (effectiveNav) {
      const weekStart = addWeeks(effectiveNav.weekStart, 1);
      goToWeek(weekStart, weekStart);
    }
  }

  function handleToday() {
    if (todayKey) {
      goToWeek(startOfWeek(todayKey), todayKey);
    }
  }

  /** Selecting a different day within the *same* week: only the filter
   * changes, so this deliberately doesn't clear/re-fetch `bookings`. */
  function handleSelectDay(selectedDay: string) {
    if (effectiveNav) {
      setNav({ weekStart: effectiveNav.weekStart, selectedDay });
    }
  }

  async function handleStatusChange(
    id: number,
    status: BookingStatusAction
  ): Promise<ProviderBooking> {
    // `PATCH /bookings/:id/status` returns Booking's canonical serializer
    // shape ({id, provider_id, patient_id, appointment_type_id, start_time,
    // end_time, status}) -- it does NOT include the display-only
    // `patient_name`/`appointment_type_name` fields `GET /bookings` adds.
    // Replacing a row wholesale with this response would blank those two
    // fields in the UI on every status change, so only `status` (the one
    // thing that actually changed) is merged onto the row already held in
    // state -- everything else about the row is unaffected by this call.
    const updated = await authFetch<{ status: BookingStatus }>(
      `${BOOKINGS_PATH}/${id}/status`,
      { method: "PATCH", body: { status } }
    );
    let merged: ProviderBooking | undefined;
    setBookings((current) =>
      (current ?? []).map((booking) => {
        if (booking.id !== id) {
          return booking;
        }
        merged = { ...booking, status: updated.status };
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
      throw new Error(`handleStatusChange: booking ${id} not found in current state`);
    }
    return merged;
  }

  let body: ReactNode;

  if (timezoneError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-red-600">
          {timezoneError}
        </p>
        <button
          type="button"
          onClick={retryTimezone}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    );
  } else if (!timezone || !effectiveNav) {
    body = <p className="text-sm text-gray-600">Loading your calendar…</p>;
  } else if (bookingsError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-red-600">
          {bookingsError}
        </p>
        <button
          type="button"
          onClick={retryBookings}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    );
  } else if (bookings === null) {
    body = <p className="text-sm text-gray-600">Loading your appointments…</p>;
  } else {
    const bookingsByDay = groupByDay(bookings, timezone);
    const countsByDay = new Map<string, number>();
    for (const [day, dayBookings] of bookingsByDay) {
      countsByDay.set(day, dayBookings.length);
    }

    const { year, month, day } = parseDateKey(effectiveNav.selectedDay);
    const dateLabel = formatFullDate(year, month, day);

    body = (
      <>
        <WeekStrip
          weekStartKey={effectiveNav.weekStart}
          selectedDay={effectiveNav.selectedDay}
          countsByDay={countsByDay}
          onSelectDay={handleSelectDay}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onToday={handleToday}
        />

        {bookings.length === 0 ? (
          <p className="text-sm text-gray-600">No appointments this week.</p>
        ) : (
          <DayAgenda
            dateLabel={dateLabel}
            bookings={bookingsByDay.get(effectiveNav.selectedDay) ?? []}
            timezone={timezone}
            onStatusChange={handleStatusChange}
          />
        )}

        <p className="text-xs text-gray-500">All times in your timezone: {timezone}</p>
      </>
    );
  }

  return <div className="flex flex-col gap-6">{body}</div>;
}
