"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useProviderCalendarData } from "@/hooks/use-provider-calendar-data";
import { generationWindowsInRange } from "@/lib/availability/generations";
import type { AvailabilityDay, BlockedTime } from "@/lib/availability/types";
import { zonedDateKey, zonedDateTimeToUtcIso } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { addWeeks, formatWeekRange, weekDates } from "@/lib/bookings/week";
import { DEFAULT_HOUR_RANGE, visibleHourRange } from "@/lib/calendar/hours";
import { layoutDayBlocks } from "@/lib/calendar/layout";
import { formatTimezone } from "@/lib/timezones";
import type { ProviderBooking } from "@/lib/bookings/types";
import { AppointmentDetailPopover } from "@/components/calendar/AppointmentDetailPopover";
import { MiniMonth } from "@/components/calendar/MiniMonth";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DayAgenda } from "./DayAgenda";
import { WeekStrip } from "./WeekStrip";

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
 * All fetching, week navigation and the status mutation live in
 * `useProviderCalendarData`; this component only decides what to render
 * from the state it returns.
 */
export function ProviderCalendar() {
  const isDesktop = useIsDesktop();
  const {
    timezone,
    timezoneError,
    retryTimezone,
    todayKey,
    nav,
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
  } = useProviderCalendarData();

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
  } else if (!timezone || !nav) {
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
    // `changeStatus` as the grid.
    const bookingsByDay = groupByDay(bookings, timezone);
    const countsByDay = new Map<string, number>();
    for (const [day, dayBookings] of bookingsByDay) {
      countsByDay.set(day, dayBookings.length);
    }

    const { year, month, day } = parseDateKey(nav.selectedDay);
    const dateLabel = formatFullDate(year, month, day);

    body = (
      <>
        <WeekStrip
          weekStartKey={nav.weekStart}
          selectedDay={nav.selectedDay}
          countsByDay={countsByDay}
          onSelectDay={selectDay}
          onPrevWeek={goToPrevWeek}
          onNextWeek={goToNextWeek}
          onToday={goToToday}
        />

        {bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments this week.</p>
        ) : (
          <DayAgenda
            dateLabel={dateLabel}
            bookings={bookingsByDay.get(nav.selectedDay) ?? []}
            timezone={timezone}
            onStatusChange={changeStatus}
          />
        )}

        <p className="text-xs text-muted-foreground">
          All times in your timezone: {formatTimezone(timezone)}
        </p>
      </>
    );
  } else {
    const bookingsByDay = groupByDay(bookings, timezone);
    const days = weekDates(nav.weekStart);
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
          onClick={goToToday}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Today
        </button>
        <button
          type="button"
          onClick={goToPrevWeek}
          aria-label="Go to previous week"
          className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
        >
          «
        </button>
        <button
          type="button"
          onClick={goToNextWeek}
          aria-label="Go to next week"
          className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
        >
          »
        </button>
        <p className="text-base font-semibold">{formatWeekRange(nav.weekStart)}</p>
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
          key={nav.weekStart}
          weekStartKey={nav.weekStart}
          todayKey={todayKey}
          onSelectDay={jumpToDay}
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
              nav.weekStart,
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
                    onStatusChange={changeStatus}
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
