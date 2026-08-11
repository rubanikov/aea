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

/** `TIMEZONES`, plus `current` if it isn't already in the list, so an
 * unrecognized value from the backend is never silently dropped from the
 * picker. */
export function timezoneOptions(current: string | undefined): readonly string[] {
  if (!current || TIMEZONES.includes(current)) {
    return TIMEZONES;
  }
  return [current, ...TIMEZONES];
}
