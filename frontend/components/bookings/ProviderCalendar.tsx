"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useProviderAvailability } from "@/hooks/use-provider-availability";
import { generationWindowsInRange } from "@/lib/availability/generations";
import type { AvailabilityDay } from "@/lib/availability/types";
import { useProviderBlockedTime } from "@/hooks/use-provider-blocked-time";
import { ApiError } from "@/lib/api/client";
import type { BlockedTime } from "@/lib/availability/types";
import { zonedDateKey, zonedDateTimeToUtcIso } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { addWeeks, formatWeekRange, startOfWeek, weekDates } from "@/lib/bookings/week";
import { DEFAULT_HOUR_RANGE, visibleHourRange } from "@/lib/calendar/hours";
import { layoutDayBlocks } from "@/lib/calendar/layout";
import { formatTimezone } from "@/lib/timezones";
import type {
  BookingStatus,
  BookingStatusAction,
  BookingStatusChangeResult,
  CancellationNotification,
  ProviderBooking,
} from "@/lib/bookings/types";
import { AppointmentDetailPopover } from "@/components/calendar/AppointmentDetailPopover";
import { MiniMonth } from "@/components/calendar/MiniMonth";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
 * The blocked-time ranges that overlap the visible week, half-open
 * (`start < weekEnd && end > weekStart`), so a block ending exactly at the
 * week's first midnight doesn't count. Pure client-side filtering over the
 * hook's one mount-time fetch — week navigation never re-fetches, it just
 * re-filters. Compared as parsed instants, not raw strings, so the result
 * doesn't depend on the API's exact ISO formatting.
 */
function blockedTimesInWeek(
  blockedTimes: readonly BlockedTime[],
  weekStartKey: string,
  timezone: string
): BlockedTime[] {
  const weekStart = Date.parse(zonedDateTimeToUtcIso(weekStartKey, "00:00", timezone));
  const weekEnd = Date.parse(
    zonedDateTimeToUtcIso(addWeeks(weekStartKey, 1), "00:00", timezone)
  );
  return blockedTimes.filter(
    (block) => Date.parse(block.start) < weekEnd && Date.parse(block.end) > weekStart
  );
}

/**
 * Provider's own calendar. On desktop widths this is a Google-style week
 * grid: toolbar (Today / prev / next / week range), a sidebar with a
 * mini month for week jumping, status legend and timezone, and a
 * time-positioned grid of appointment blocks whose height is their
 * duration — clicking a block opens a detail popover with the
 * role-appropriate status actions (mark completed, mark no-show, cancel
 * with a required reason). On narrow screens it falls back to the
 * previous week-strip + day-agenda list (`WeekStrip`/`DayAgenda`), which
 * shares the same fetches, state, and status-action implementation.
 * Deliberately no confirm/decline action anywhere, and no desktop Day
 * view in this pass: every booking arrives pre-confirmed via
 * auto-accept, and week view is the one desktop view.
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
export function ProviderCalendar() {
  const authFetch = useAuthenticatedRequest();
  const isDesktop = useIsDesktop();

  const [timezone, setTimezone] = useState<string | null>(null); // null = loading
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneReloadKey, setTimezoneReloadKey] = useState(0);

  const [nav, setNav] = useState<Nav | null>(null);

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
  const effectiveNav: Nav | null =
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
   * moves the selected day along with it. Mirrors `SlotBrowser`'s
   * `goToMonth`, which resets its own selected date the same way on month
   * navigation. Deliberately does NOT touch the schedule fetch: live +
   * pending generations are already in memory, and which one governs a
   * day is a date comparison (see `generationWindowsInRange`). */
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

  /** Mini-month click: jump the grid to that day's week. Selecting a day
   * already inside the visible week is still routed through `goToWeek`
   * (same week, so the refetch is for the same range) to keep one code
   * path; the selected day matters only to the narrow-screen agenda. */
  function handleJumpToDay(dateKey: string) {
    goToWeek(startOfWeek(dateKey), dateKey);
  }

  /** Selecting a different day within the *same* week (narrow-screen
   * agenda only): only the filter changes, so this deliberately doesn't
   * clear or re-fetch `bookings`. */
  function handleSelectDay(selectedDay: string) {
    if (effectiveNav) {
      setNav({ weekStart: effectiveNav.weekStart, selectedDay });
    }
  }

  async function handleStatusChange(
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
      throw new Error(`handleStatusChange: booking ${id} not found in current state`);
    }
    return { booking: merged, notification: updated.notification };
  }

  let body: ReactNode;

  if (timezoneError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-danger-text">
          {timezoneError}
        </p>
        <button
          type="button"
          onClick={retryTimezone}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  } else if (!timezone || !effectiveNav) {
    body = <p className="text-sm text-muted-foreground">Loading your calendar…</p>;
  } else if (bookingsError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-danger-text">
          {bookingsError}
        </p>
        <button
          type="button"
          onClick={retryBookings}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  } else if (bookings === null) {
    body = <p className="text-sm text-muted-foreground">Loading your appointments…</p>;
  } else if (!isDesktop) {
    // Narrow-screen fallback: the previous week-strip + day-agenda list,
    // unchanged in structure and behavior, sharing the same fetches and
    // `handleStatusChange` as the grid.
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
          <p className="text-sm text-muted-foreground">No appointments this week.</p>
        ) : (
          <DayAgenda
            dateLabel={dateLabel}
            bookings={bookingsByDay.get(effectiveNav.selectedDay) ?? []}
            timezone={timezone}
            onStatusChange={handleStatusChange}
          />
        )}

        <p className="text-xs text-muted-foreground">
          All times in your timezone: {formatTimezone(timezone)}
        </p>
      </>
    );
  } else {
    const bookingsByDay = groupByDay(bookings, timezone);
    const days = weekDates(effectiveNav.weekStart);
    const weekHours: AvailabilityDay[] = current
      ? generationWindowsInRange(current, pending, days).map((window) => ({
          id: window.id,
          day_of_week: window.day_of_week,
          start_time: window.start_time,
          end_time: window.end_time,
          effective_from: null,
        }))
      : (availability ?? []);
    const availabilityKnownEmpty = availability !== null && availability.length === 0;
    // While the schedule is loading (or failed), the grid is bounded by
    // the week's bookings alone; `DEFAULT_HOUR_RANGE` keeps a recognizable
    // grid on screen even with nothing to derive a range from. Once
    // loaded, the range follows the generation that actually governs this
    // week — a pending hours change is visible on dates after it starts.
    const range =
      visibleHourRange(weekHours, bookings, timezone) ?? DEFAULT_HOUR_RANGE;

    const toolbar = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleToday}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Today
        </button>
        <button
          type="button"
          onClick={handlePrevWeek}
          aria-label="Go to previous week"
          className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
        >
          «
        </button>
        <button
          type="button"
          onClick={handleNextWeek}
          aria-label="Go to next week"
          className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
        >
          »
        </button>
        <p className="text-base font-semibold">{formatWeekRange(effectiveNav.weekStart)}</p>
      </div>
    );

    const availabilityBanner = availabilityError ? (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground"
      >
        <span>{availabilityError}</span>
        <button
          type="button"
          onClick={retryAvailability}
          className="rounded border border-warning-border px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    ) : null;

    // Same non-blocking shape as the availability banner, its own scoped
    // retry. On failure the grid shows an ABSENCE of hatching plus this
    // warning — never anything painted as blocked that isn't confirmed.
    const blockedTimeBanner = blockedTimeError ? (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground"
      >
        <span>{blockedTimeError}</span>
        <button
          type="button"
          onClick={retryBlockedTime}
          className="rounded border border-warning-border px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    ) : null;

    const sidebar = (
      <div className="flex w-56 shrink-0 flex-col gap-5">
        <MiniMonth
          key={effectiveNav.weekStart}
          weekStartKey={effectiveNav.weekStart}
          todayKey={todayKey}
          onSelectDay={handleJumpToDay}
        />
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Status legend
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 border border-(--slot-open-border) border-l-4 border-l-(--status-confirmed-border) bg-(--slot-open-bg)"
            />
            Confirmed
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 border border-dashed border-success-border bg-(--status-completed-bg)"
            />
            Completed
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 border border-(--grid-line) bg-(--status-cancelled-bg)"
            />
            Cancelled / no-show
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Timezone
          </p>
          <p className="text-sm text-muted-foreground">{formatTimezone(timezone)}</p>
        </div>
      </div>
    );

    let main: ReactNode;
    if (availabilityKnownEmpty && bookings.length === 0) {
      // Nothing configured AND nothing booked: an empty grid would just
      // be a wall of gridlines with no meaning. Point at setup instead.
      main = (
        <Card className="max-w-md self-start">
          <CardHeader>
            <CardTitle>No working hours set up yet</CardTitle>
            <CardDescription>
              Your calendar shows the hours you&apos;re available. Set your weekly
              working hours to see them here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/provider">Set working hours</Link>
            </Button>
          </CardContent>
        </Card>
      );
    } else {
      const timezoneForGrid = timezone;
      main = (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {availabilityKnownEmpty ? (
            <p className="text-xs text-muted-foreground">
              No working hours configured — showing booked times only.{" "}
              <Link href="/provider" className="text-link underline">
                Set working hours
              </Link>
            </p>
          ) : null}
          <TimeGrid
            days={days}
            todayKey={todayKey}
            range={range}
            timezone={timezoneForGrid}
            blockedTimes={blockedTimesInWeek(
              blockedTimes ?? [],
              effectiveNav.weekStart,
              timezoneForGrid
            )}
            overlay={
              bookings.length === 0 ? (
                <p className="rounded border border-dashed border-border-strong bg-card px-4 py-2 text-sm text-muted-foreground">
                  No appointments this week.
                </p>
              ) : null
            }
            renderDay={(dayKey) => {
              const dayBookings = bookingsByDay.get(dayKey) ?? [];
              const geometryById = layoutDayBlocks(dayBookings, dayKey, timezoneForGrid, range);
              return dayBookings.map((booking) => {
                const geometry = geometryById.get(booking.id);
                return geometry ? (
                  <AppointmentDetailPopover
                    key={booking.id}
                    booking={booking}
                    timezone={timezoneForGrid}
                    geometry={geometry}
                    onStatusChange={handleStatusChange}
                  />
                ) : null;
              });
            }}
          />
        </div>
      );
    }

    body = (
      <>
        {toolbar}
        {availabilityBanner}
        {blockedTimeBanner}
        <div className="flex gap-6">
          {sidebar}
          {main}
        </div>
      </>
    );
  }

  return <div className="flex flex-col gap-6">{body}</div>;
}
