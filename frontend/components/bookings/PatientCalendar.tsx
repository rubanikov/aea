"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { usePatientTimeZone } from "@/hooks/use-patient-timezone";
import { ApiError } from "@/lib/api/client";
import { zonedDateKey } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { addWeeks, formatWeekRange, startOfWeek, weekDates } from "@/lib/bookings/week";
import { DEFAULT_HOUR_RANGE, visibleHourRange } from "@/lib/calendar/hours";
import { layoutDayBlocks, type BlockGeometry } from "@/lib/calendar/layout";
import { formatTimezone } from "@/lib/timezones";
import {
  BOOKING_STATUS_DISPLAY,
  formatBookingTimeRange,
  formatProviderClockRange,
} from "@/lib/bookings/format";
import type { PatientBooking } from "@/lib/bookings/types";
import { MiniMonth } from "@/components/calendar/MiniMonth";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { WeekStrip } from "./WeekStrip";

const BOOKINGS_MINE_PATH = "/bookings/mine";

interface Nav {
  /** Monday of the visible week. */
  weekStart: string;
  selectedDay: string;
}

/**
 * The bookings whose start falls on a day of the visible week, in the
 * patient's timezone. `GET /bookings/mine` takes no `date_from`/`date_to`
 * query params (unlike the provider's `GET /bookings` — see
 * `BookingMineListView`'s docstring in `backend/bookings/views.py`), so
 * the full list is fetched once per mount and re-filtered client-side on
 * every week navigation, the same mount-keyed-then-filtered pattern
 * `ProviderCalendar` uses for blocked time.
 */
function bookingsInWeek(
  bookings: readonly PatientBooking[],
  weekStartKey: string,
  timezone: string
): PatientBooking[] {
  const week = new Set(weekDates(weekStartKey));
  return bookings.filter((booking) => week.has(zonedDateKey(booking.start_time, timezone)));
}

function groupByDay(
  bookings: readonly PatientBooking[],
  timezone: string
): Map<string, PatientBooking[]> {
  const grouped = new Map<string, PatientBooking[]>();
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

interface PatientAppointmentBlockProps {
  booking: PatientBooking;
  timezone: string;
  geometry: BlockGeometry;
}

/**
 * One positioned booking block on the patient's week grid. Same geometry
 * and status styling as the provider grid's `AppointmentBlock`, but
 * display-only: a `<div>`, not a `<button>`, because there is nothing for
 * a patient to do on a block here — status changes are provider-only
 * concepts, and cancel/reschedule live exclusively on the "My
 * Appointments" list (`PatientAppointments`). The status is carried as
 * visually-hidden text (never color alone), matching
 * `BookingStatusBadge`'s icon+text rule.
 *
 * The headline range is the patient's own clock, because that's the clock
 * the grid's hour axis is drawn on and a block has to agree with the row
 * it sits in. When the provider keeps a different one, their time follows
 * on its own line: the patient picked this slot on the provider's clock,
 * so a block that only ever says "8:00am" for a 9:00am Eastern
 * appointment reads as though the booking moved.
 */
function PatientAppointmentBlock({ booking, timezone, geometry }: PatientAppointmentBlockProps) {
  const timeRange = formatBookingTimeRange(booking.start_time, booking.end_time, timezone);
  const providerClockRange = formatProviderClockRange(
    booking.start_time,
    booking.end_time,
    booking.provider_timezone,
    timezone
  );
  const statusText = BOOKING_STATUS_DISPLAY[booking.status].text;
  const closed = booking.status === "cancelled" || booking.status === "no_show";
  const completed = booking.status === "completed";

  return (
    <div
      style={{
        top: `${geometry.topPercent}%`,
        height: `${geometry.heightPercent}%`,
        left: `${geometry.leftPercent}%`,
        width: `${geometry.widthPercent}%`,
      }}
      className={cn(
        "absolute overflow-hidden rounded-sm border px-1 py-0.5 text-left text-xs leading-tight",
        "min-h-4",
        !closed &&
          !completed &&
          "border-(--slot-open-border) border-l-4 border-l-(--status-confirmed-border) bg-(--slot-open-bg)",
        completed &&
          "border-dashed border-(--success-border) bg-(--status-completed-bg) text-(--status-completed-foreground)",
        closed &&
          "border-(--grid-line) bg-(--status-cancelled-bg) text-(--status-cancelled-foreground) line-through"
      )}
    >
      <span className="block truncate font-medium">{timeRange}</span>
      <span className="block truncate">
        {booking.appointment_type_name} — {booking.provider_name}
      </span>
      {providerClockRange ? (
        <span className="block truncate text-muted-foreground">
          {providerClockRange} provider&apos;s time
        </span>
      ) : null}
      <span className="sr-only">{statusText}</span>
    </div>
  );
}

/**
 * Patient's own calendar: the dashboard's week-grid view of their booked
 * appointments, structurally mirroring `ProviderCalendar` (same
 * `TimeGrid`/`MiniMonth` primitives, same toolbar pattern, same
 * desktop-vs-narrow split via `useIsDesktop` with a `WeekStrip` + day-list
 * fallback), minus everything provider-specific:
 *
 * - No availability or blocked-time overlays — patients have no working
 *   hours. The grid's visible hours derive from the week's bookings alone
 *   (`visibleHourRange` with an empty availability array), falling back to
 *   `DEFAULT_HOUR_RANGE` on an empty week so the calendar stays
 *   recognizable as a calendar.
 * - No status actions and no detail popover: blocks are display-only.
 *   Cancel/reschedule stays on `/patient/appointments`; the primary action
 *   here is the toolbar's "+ Book appointment" link into `/patient/book`.
 * - Timezone is `usePatientTimeZone()` (browser-detected, the patient-side
 *   convention `PatientAppointments`/`SlotBrowser` established), not a
 *   `GET /profile` fetch, so there's no timezone request to block on.
 *   It's the only coherent clock for the grid's hour axis, since one
 *   patient's week can hold appointments with providers in several zones
 *   and drawing each on its own clock would stack unrelated times into
 *   the same row as a false conflict. Each block carries the provider's
 *   own time as a second line when the two differ, so the time the
 *   patient actually picked is still on the screen.
 *
 * Data comes from `GET /bookings/mine` (never `GET /bookings`, which 403s
 * a patient), fetched once per mount and filtered client-side to the
 * visible week (`bookingsInWeek`) — that endpoint has no date-range
 * params, and a patient's full appointment list is demo-sized. Week
 * navigation therefore never refetches; the load-error retry re-fires the
 * one fetch.
 *
 * The sidebar keeps a lightweight status legend: cancelled and completed
 * bookings still appear on the grid (struck-through / dashed), so the
 * coloring needs a key even though nothing here is actionable.
 */
export function PatientCalendar() {
  const authFetch = useAuthenticatedRequest();
  const isDesktop = useIsDesktop();
  const timezone = usePatientTimeZone();

  const [nav, setNav] = useState<Nav | null>(null);

  const [bookings, setBookings] = useState<PatientBooking[] | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const todayKey = timezone ? zonedDateKey(new Date().toISOString(), timezone) : null;
  const effectiveNav: Nav | null =
    nav ?? (todayKey ? { weekStart: startOfWeek(todayKey), selectedDay: todayKey } : null);

  useEffect(() => {
    let cancelled = false;

    authFetch<PatientBooking[]>(BOOKINGS_MINE_PATH)
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
          setLoadError("Couldn't load your calendar — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  function retry() {
    setLoadError(null);
    setBookings(null);
    setReloadKey((key) => key + 1);
  }

  /** Week navigation is a pure re-filter over the one fetched list —
   * unlike `ProviderCalendar.goToWeek`, there's nothing to clear or
   * refetch. */
  function goToWeek(weekStart: string, selectedDay: string) {
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

  function handleJumpToDay(dateKey: string) {
    goToWeek(startOfWeek(dateKey), dateKey);
  }

  /** Narrow-screen agenda only: same-week day selection changes the
   * filter, not the week. */
  function handleSelectDay(selectedDay: string) {
    if (effectiveNav) {
      setNav({ weekStart: effectiveNav.weekStart, selectedDay });
    }
  }

  const bookAppointmentLink = (
    <Link
      href="/patient/book"
      className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
    >
      + Book appointment
    </Link>
  );

  let body: ReactNode;

  if (loadError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-danger-text">
          {loadError}
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  } else if (!timezone || !effectiveNav || bookings === null) {
    body = <p className="text-sm text-muted-foreground">Loading your calendar…</p>;
  } else if (!isDesktop) {
    // Narrow-screen fallback: week strip + a per-day list, same shape as
    // ProviderCalendar's agenda fallback but with read-only rows.
    const weekBookings = bookingsInWeek(bookings, effectiveNav.weekStart, timezone);
    const bookingsByDay = groupByDay(weekBookings, timezone);
    const countsByDay = new Map<string, number>();
    for (const [day, dayBookings] of bookingsByDay) {
      countsByDay.set(day, dayBookings.length);
    }

    const { year, month, day } = parseDateKey(effectiveNav.selectedDay);
    const dateLabel = formatFullDate(year, month, day);
    const dayBookings = bookingsByDay.get(effectiveNav.selectedDay) ?? [];

    body = (
      <>
        <div className="flex justify-end">{bookAppointmentLink}</div>

        <WeekStrip
          weekStartKey={effectiveNav.weekStart}
          selectedDay={effectiveNav.selectedDay}
          countsByDay={countsByDay}
          onSelectDay={handleSelectDay}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onToday={handleToday}
        />

        {weekBookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments this week.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{dateLabel}</h2>
            {dayBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No appointments on {dateLabel}.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {dayBookings.map((booking) => {
                  const providerClockRange = formatProviderClockRange(
                    booking.start_time,
                    booking.end_time,
                    booking.provider_timezone,
                    timezone
                  );
                  return (
                    <li
                      key={booking.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-strong px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {formatBookingTimeRange(
                            booking.start_time,
                            booking.end_time,
                            timezone
                          )}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {booking.appointment_type_name} — {booking.provider_name}
                        </span>
                        {providerClockRange ? (
                          <span className="text-xs text-muted-foreground">
                            {providerClockRange} provider&apos;s time
                          </span>
                        ) : null}
                      </div>
                      <BookingStatusBadge status={booking.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          All times in your timezone: {formatTimezone(timezone)}
        </p>
      </>
    );
  } else {
    const weekBookings = bookingsInWeek(bookings, effectiveNav.weekStart, timezone);
    const bookingsByDay = groupByDay(weekBookings, timezone);
    const days = weekDates(effectiveNav.weekStart);
    // No availability concept for a patient: the visible hours come from
    // the week's bookings alone, or the default range on an empty week.
    const range = visibleHourRange([], weekBookings, timezone) ?? DEFAULT_HOUR_RANGE;

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
        <div className="ml-auto">{bookAppointmentLink}</div>
      </div>
    );

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
            Your timezone
          </p>
          <p className="text-sm text-muted-foreground">{formatTimezone(timezone)}</p>
        </div>
      </div>
    );

    const timezoneForGrid = timezone;
    const main = (
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TimeGrid
          days={days}
          todayKey={todayKey}
          range={range}
          overlay={
            weekBookings.length === 0 ? (
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
                <PatientAppointmentBlock
                  key={booking.id}
                  booking={booking}
                  timezone={timezoneForGrid}
                  geometry={geometry}
                />
              ) : null;
            });
          }}
        />
      </div>
    );

    body = (
      <>
        {toolbar}
        <div className="flex gap-6">
          {sidebar}
          {main}
        </div>
      </>
    );
  }

  return <div className="flex flex-col gap-6">{body}</div>;
}
