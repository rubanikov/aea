/**
 * Pure calendar-grid math for the patient-facing date picker: a 6-week,
 * Sunday-first month grid, plus the small set of formatting helpers the
 * picker and slot list need. No date library, matching
 * `lib/availability/timezone.ts`'s "native only" precedent, and this needs
 * even less: day-of-week and days-in-month for a given Gregorian
 * year/month/day never depend on any real-world clock or timezone, so this
 * can use `Date`'s *local* constructor purely as calendar arithmetic
 * (never to represent a real instant, and never read back as UTC)
 * without any DST/offset risk. Actual timezone conversion, from a UTC
 * slot instant to the patient's local calendar date/time, happens
 * separately, in `lib/availability/timezone.ts`'s
 * `zonedDateKey`/`zonedTimeLabel`.
 */

export interface YearMonth {
  year: number;
  /** 1-12. */
  month: number;
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  /** "YYYY-MM-DD", matching the `/scheduling/slots` API's `date_from`/
   * `date_to` format and `zonedDateKey`'s output: the shared key used to
   * look up "does this day have any open slots". */
  dateKey: string;
  /** `false` for the leading/trailing days from adjacent months shown to
   * fill out a complete week. */
  inCurrentMonth: boolean;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Sunday-first weekday header row. */
export const WEEKDAY_HEADERS: readonly string[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** `visibleMonth` shifted by `delta` months (either direction), rolling
 * over into adjacent years as needed. */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const zeroBased = month - 1 + delta;
  const normalizedMonth = ((zeroBased % 12) + 12) % 12;
  const yearOffset = Math.floor(zeroBased / 12);
  return { year: year + yearOffset, month: normalizedMonth + 1 };
}

export function formatMonthYear({ year, month }: YearMonth): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month`: ordinary
  // calendar arithmetic, not a real-instant lookup (see module docstring).
  return new Date(year, month, 0).getDate();
}

function weekdayIndexOfFirst(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export function weekdayName(year: number, month: number, day: number): string {
  return WEEKDAY_NAMES[new Date(year, month - 1, day).getDay()];
}

/** e.g. `(2026, 8, 18)` -> `"Tuesday, August 18, 2026"`. */
export function formatFullDate(year: number, month: number, day: number): string {
  return `${weekdayName(year, month, day)}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/**
 * A 42-cell (6-week), Sunday-first grid for `visibleMonth`, including the
 * leading/trailing days from the adjacent months needed to fill complete
 * weeks (`inCurrentMonth: false`). A fixed 42-cell grid keeps the picker's
 * height stable across months rather than growing/shrinking by a row.
 */
export function monthGrid(visibleMonth: YearMonth): CalendarDay[] {
  const { year, month } = visibleMonth;
  const leadingCount = weekdayIndexOfFirst(year, month);
  const currentMonthDays = daysInMonth(year, month);
  const previous = addMonths(visibleMonth, -1);
  const previousMonthDays = daysInMonth(previous.year, previous.month);
  const next = addMonths(visibleMonth, 1);

  const days: CalendarDay[] = [];

  for (let i = 0; i < leadingCount; i += 1) {
    const day = previousMonthDays - leadingCount + 1 + i;
    days.push({
      year: previous.year,
      month: previous.month,
      day,
      dateKey: dateKey(previous.year, previous.month, day),
      inCurrentMonth: false,
    });
  }

  for (let day = 1; day <= currentMonthDays; day += 1) {
    days.push({ year, month, day, dateKey: dateKey(year, month, day), inCurrentMonth: true });
  }

  let trailingDay = 1;
  while (days.length < 42) {
    days.push({
      year: next.year,
      month: next.month,
      day: trailingDay,
      dateKey: dateKey(next.year, next.month, trailingDay),
      inCurrentMonth: false,
    });
    trailingDay += 1;
  }

  return days;
}
