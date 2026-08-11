/**
 * Formats an ISO 8601 timestamp as an explicit UTC string, e.g.
 * `2026-08-10 14:32:07Z`.
 *
 * Deliberately not routed through any local-timezone formatting: the
 * audit log is meant to be a single, unambiguous source of truth, and
 * showing it in the viewer's local time would undermine that (two admins
 * looking at the same entry from different timezones should see the same
 * string). Every other formatted-timestamp surface in the app is free to
 * localize; this one is not.
 *
 * Falls back to the raw input for a value that doesn't parse as a date,
 * rather than rendering "Invalid Date".
 */
export function formatAuditTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return `${date.toISOString().slice(0, 19).replace("T", " ")}Z`;
}
