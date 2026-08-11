/**
 * Pure week-strip math for the provider calendar: a Monday-first week,
 * independent of `lib/scheduling/calendar.ts`'s Sunday-first month grid,
 * which belongs to a different screen (the patient date picker) with its
 * own convention. Uses the same "calendar-only, no real instant"
 * arithmetic that module established: a Gregorian day offset never
 * depends on any real-world clock or timezone, so this can use `Date`'s
 * *local* constructor purely for day-counting, never to represent a real
 * instant.
 */

import { dateKey, parseDateKey } from "@/lib/scheduling/calendar";

export const SHORT_WEEKDAY_NAMES: readonly string[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

const SHORT_MONTH_NAMES: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shiftDateKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const shifted = new Date(year, month - 1, day + days);
  return dateKey(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate());
}

/** Monday=0 .. Sunday=6, unlike `Date.getDay()`'s Sunday=0. The offset
 * back to that week's Monday. */
function mondayIndexOf(key: string): number {
  const { year, month, day } = parseDateKey(key);
  const jsWeekday = new Date(year, month - 1, day).getDay(); // 0=Sun..6=Sat
  return (jsWeekday + 6) % 7;
}

/** The Monday on or before `key`'s week. */
export function startOfWeek(key: string): string {
  return shiftDateKey(key, -mondayIndexOf(key));
}

/** `weekStartKey` (a Monday) shifted by `deltaWeeks` weeks, either
 * direction. */
export function addWeeks(weekStartKey: string, deltaWeeks: number): string {
  return shiftDateKey(weekStartKey, deltaWeeks * 7);
}

/** The 7 dateKeys for the week starting `weekStartKey` (a Monday),
 * Monday through Sunday in order. */
export function weekDates(weekStartKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDateKey(weekStartKey, index));
}

function shortMonthDay(key: string): { month: string; day: number; year: number } {
  const { year, month, day } = parseDateKey(key);
  return { month: SHORT_MONTH_NAMES[month - 1], day, year };
}

/**
 * e.g. `("2026-08-17")` -> `"Week of Aug 17–23, 2026"`. Crosses a month or
 * year boundary cleanly (e.g. `"Week of Aug 31–Sep 6, 2026"`,
 * `"Week of Dec 29, 2026–Jan 4, 2027"`) rather than dropping the second
 * month/year.
 */
export function formatWeekRange(weekStartKey: string): string {
  const start = shortMonthDay(weekStartKey);
  const end = shortMonthDay(shiftDateKey(weekStartKey, 6));

  if (start.year !== end.year) {
    return `Week of ${start.month} ${start.day}, ${start.year}–${end.month} ${end.day}, ${end.year}`;
  }
  if (start.month !== end.month) {
    return `Week of ${start.month} ${start.day}–${end.month} ${end.day}, ${end.year}`;
  }
  return `Week of ${start.month} ${start.day}–${end.day}, ${end.year}`;
}
