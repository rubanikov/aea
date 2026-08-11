import { zonedTimeLabel } from "@/lib/availability/timezone";
import type { BookingStatus } from "./types";

/**
 * Icon + text for each `BookingStatus` value -- TICKET-08's accept
 * criteria: status is shown with text/icon, never color alone. No
 * booking-status badge convention existed anywhere in this codebase before
 * this ticket; established here (see `BookingStatusBadge`) as what other
 * screens showing a booking's status should reuse rather than reinventing
 * their own (e.g. TICKET-11's collision-warning modal, built in parallel,
 * is expected to reuse this same convention per its own ticket text).
 */
export const BOOKING_STATUS_DISPLAY: Record<BookingStatus, { icon: string; text: string }> = {
  requested: { icon: "○", text: "REQUESTED" },
  confirmed: { icon: "●", text: "CONFIRMED" },
  completed: { icon: "✓", text: "COMPLETED" },
  cancelled: { icon: "✕", text: "CANCELLED" },
  no_show: { icon: "⊘", text: "NO-SHOW" },
};

/**
 * e.g. `("...T13:00:00.000Z", "...T13:45:00.000Z", "America/New_York")` ->
 * `"9:00–9:45am"`, matching the wireframe's row format. Built on
 * `lib/availability/timezone.ts`'s `zonedTimeLabel` (already the
 * established single-time formatter); when both ends share an am/pm
 * period, it's dropped from the start label rather than repeated (a range
 * crossing noon, e.g. `"11:45am–12:15pm"`, keeps both).
 */
export function formatBookingTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string
): string {
  const start = zonedTimeLabel(startIso, timeZone);
  const end = zonedTimeLabel(endIso, timeZone);
  const startPeriod = start.slice(-2);
  const endPeriod = end.slice(-2);
  return startPeriod === endPeriod ? `${start.slice(0, -2)}–${end}` : `${start}–${end}`;
}
