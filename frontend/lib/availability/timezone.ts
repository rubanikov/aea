/**
 * Converts between a provider's wall-clock date/time (what the blocked-
 * time form's native `<input type="date">`/`<input type="time">` pair
 * collects) and the UTC ISO instant the API stores, using only built-in
 * `Intl`/`Date`, no date-timezone library.
 */

/** The offset (in ms) such that `local wall-clock time = utcMillis +
 * offset` for the given IANA zone, at (approximately) `utcMillis`. Computed
 * by formatting that instant in the target zone and re-reading the result
 * as if it were UTC, the same single-pass technique `date-fns-tz`'s
 * `zonedTimeToUtc` uses. Not exact for a wall-clock time that falls
 * inside the one-hour window a DST transition itself creates (an
 * ambiguous or skipped local time); an acceptable gap for a feature this
 * small, since blocked-time ranges aren't tied to precise instants.
 */
function timeZoneOffsetMillis(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMillis));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second)
  );
  return asUtc - utcMillis;
}

/**
 * Converts a "YYYY-MM-DD" date and "HH:MM" time, interpreted as wall-clock
 * time in `timeZone`, to a UTC ISO 8601 string, e.g.
 * `("2026-08-24", "00:00", "America/New_York")` ->
 * `"2026-08-24T04:00:00.000Z"`.
 */
export function zonedDateTimeToUtcIso(
  date: string,
  time: string,
  timeZone: string
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = timeZoneOffsetMillis(utcGuess, timeZone);
  return new Date(utcGuess - offset).toISOString();
}

/**
 * Renders a UTC ISO instant as a wall-clock string in `timeZone`, e.g.
 * `"Aug 24, 2026 00:00"`. Falls back to the raw input for a value that
 * doesn't parse as a date, rather than rendering "Invalid Date" (matching
 * `lib/audit/format.ts`'s `formatAuditTimestamp`).
 */
export function formatZonedDateTime(isoTimestamp: string, timeZone: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.month} ${lookup.day}, ${lookup.year} ${lookup.hour}:${lookup.minute}`;
}

/**
 * The wall-clock "YYYY-MM-DD" date a UTC instant falls on when observed in
 * `timeZone`, e.g. `("2026-08-24T02:00:00.000Z", "America/New_York")` ->
 * `"2026-08-23"` (22:00 the previous day in EDT). Used to bucket open
 * slots by the local calendar date they land on for a given viewer: the
 * patient's own zone for "which day does this slot show under", the
 * provider's for cross-checking, independent of which date the API's
 * `date_from`/`date_to` query range was expressed in. Same
 * `Intl.DateTimeFormat().formatToParts` technique as `formatZonedDateTime`,
 * just narrowed to the date portion and ISO-ordered so the result sorts
 * and compares correctly as a plain string key.
 */
export function zonedDateKey(isoTimestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * Wall-clock time-of-day for a UTC instant, observed in `timeZone` and
 * rendered 12-hour with a lowercase am/pm suffix and no leading zero, e.g.
 * `"9:00am"`, `"12:30pm"`. Reads `dayPeriod` off `Intl`'s own parts
 * (rather than computing am/pm from the hour number by hand) and strips
 * it down to bare letters, since some locales/ICU builds render it as
 * `"AM"` and others as `"a.m."`.
 */
export function zonedTimeLabel(isoTimestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(new Date(isoTimestamp));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const period = (lookup.dayPeriod ?? "").replace(/[^a-zA-Z]/g, "").toLowerCase();
  return `${lookup.hour}:${lookup.minute}${period}`;
}
