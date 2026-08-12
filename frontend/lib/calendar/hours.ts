/**
 * Visible-hour-range math for the provider week grid: which wall-clock
 * hours the grid's vertical axis spans. Pure functions, no fetching.
 *
 * The provider's configured `Availability` windows form the base range
 * (floored/ceiled to whole hours). The range is then EXTENDED — never
 * clipped — to include any actual booking that falls outside those hours,
 * so a manually-created out-of-hours appointment is still visible on the
 * grid rather than cut off. All availability rows count regardless of
 * weekday, since the grid always renders all seven day columns.
 */

import type { AvailabilityDay } from "@/lib/availability/types";
import { zonedDateKey } from "@/lib/availability/timezone";

export interface HourRange {
  /** First visible hour, 0–23. */
  startHour: number;
  /** One past the last visible hour, 1–24 (exclusive bound). */
  endHour: number;
}

/** The grid never renders narrower than this many hours; a degenerate
 * single-row calendar stops looking like a calendar. */
export const MIN_VISIBLE_HOURS = 4;

/** What the grid falls back to when `visibleHourRange` returns `null`
 * (no availability data and no bookings) but a grid must still render —
 * e.g. while availability is loading or after its fetch failed. */
export const DEFAULT_HOUR_RANGE: HourRange = { startHour: 9, endHour: 17 };

interface BookingLike {
  start_time: string;
  end_time: string;
}

/** Wall-clock `{hour, minute}` of a UTC instant observed in `timeZone`. */
function zonedHourMinute(iso: string, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(lookup.hour), minute: Number(lookup.minute) };
}

/** "HH:MM[:SS]" (DRF `TimeField`) -> `{hour, minute}`. Seconds are only
 * ever "00" from the backend, so they're ignored. */
function parseWallTime(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function floorHour({ hour }: { hour: number }): number {
  return hour;
}

function ceilHour({ hour, minute }: { hour: number; minute: number }): number {
  return minute > 0 ? hour + 1 : hour;
}

/**
 * The wall-clock hour range the week grid should span, or `null` when
 * there is nothing to derive one from (no availability rows AND no
 * bookings) — the caller decides what an empty calendar looks like (see
 * `DEFAULT_HOUR_RANGE` and `ProviderCalendar`'s zero-availability states).
 *
 * When the computed span is narrower than `MIN_VISIBLE_HOURS`, it's
 * widened by extending the end first (toward midnight), then the start
 * (toward 0), so the grid never renders a degenerate strip.
 */
export function visibleHourRange(
  availability: readonly AvailabilityDay[],
  bookings: readonly BookingLike[],
  timeZone: string
): HourRange | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const window of availability) {
    start = Math.min(start, floorHour(parseWallTime(window.start_time)));
    end = Math.max(end, ceilHour(parseWallTime(window.end_time)));
  }

  for (const booking of bookings) {
    start = Math.min(start, floorHour(zonedHourMinute(booking.start_time, timeZone)));
    // A booking whose end lands on a later wall-clock day than its start
    // (crossing midnight) runs to the bottom of the grid; ceiling its
    // next-day end hour would *shrink* the range instead.
    const crossesMidnight =
      zonedDateKey(booking.end_time, timeZone) !== zonedDateKey(booking.start_time, timeZone);
    end = Math.max(
      end,
      crossesMidnight ? 24 : ceilHour(zonedHourMinute(booking.end_time, timeZone))
    );
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  start = Math.max(0, Math.min(23, start));
  end = Math.max(start + 1, Math.min(24, end));

  const missing = MIN_VISIBLE_HOURS - (end - start);
  if (missing > 0) {
    end = Math.min(24, end + missing);
    start = Math.max(0, start - (MIN_VISIBLE_HOURS - (end - start)));
  }

  return { startHour: start, endHour: end };
}
