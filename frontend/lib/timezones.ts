/**
 * Curated list of common IANA timezone identifiers for the account settings
 * timezone picker. A static list (rather than `Intl.supportedValuesOf`,
 * whose result can differ between Node/browser ICU builds) keeps this
 * deterministic between server and client rendering.
 */
export const TIMEZONES: readonly string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
];

/**
 * The name people actually use for each offered zone, keyed by IANA
 * identifier. Nobody thinks of their timezone as "America/Chicago"; they
 * think of it as Central. `Intl`'s own `timeZoneName: "long"` would give
 * the *current* name ("Central Daylight Time"), which flips twice a year
 * and would render a value stored today as something else in November, so
 * these are the DST-neutral names instead — "Standard" appears only for
 * zones that observe no daylight saving at all.
 */
const TIMEZONE_NAMES: Readonly<Record<string, string>> = {
  UTC: "Coordinated Universal Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Denver": "Mountain Time",
  "America/Chicago": "Central Time",
  "America/New_York": "Eastern Time",
  "America/Halifax": "Atlantic Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
  "America/Sao_Paulo": "Brasilia Time",
  "Europe/London": "United Kingdom Time",
  "Europe/Paris": "Central European Time",
  "Europe/Berlin": "Central European Time",
  "Europe/Moscow": "Moscow Time",
  "Africa/Cairo": "Eastern European Time",
  "Africa/Johannesburg": "South Africa Time",
  "Asia/Jerusalem": "Israel Time",
  "Asia/Dubai": "Gulf Standard Time",
  "Asia/Kolkata": "India Standard Time",
  "Asia/Bangkok": "Indochina Time",
  "Asia/Shanghai": "China Standard Time",
  "Asia/Tokyo": "Japan Standard Time",
  "Asia/Seoul": "Korea Standard Time",
  "Australia/Sydney": "Australian Eastern Time",
  "Australia/Perth": "Australian Western Time",
  "Pacific/Auckland": "New Zealand Time",
};

/**
 * Display label for a zone, e.g. `"America/New_York"` -> `"Eastern Time
 * (New York)"`. Display only — the picker still stores the IANA
 * identifier, which is what the API validates against. A zone with no
 * entry in `TIMEZONE_NAMES` (only reachable via a `current` value from the
 * backend that isn't on the curated list) falls back to its city alone,
 * e.g. `"America/Argentina/Buenos_Aires"` -> `"Buenos Aires"`.
 */
export function formatTimezone(timezone: string): string {
  const city = timezone.slice(timezone.lastIndexOf("/") + 1).replace(/_/g, " ");
  const name = TIMEZONE_NAMES[timezone];
  return name ? `${name} (${city})` : city;
}

/** `TIMEZONES`, plus `current` if it isn't already in the list, so an
 * unrecognized value from the backend is never silently dropped from the
 * picker. */
export function timezoneOptions(current: string | undefined): readonly string[] {
  if (!current || TIMEZONES.includes(current)) {
    return TIMEZONES;
  }
  return [current, ...TIMEZONES];
}
