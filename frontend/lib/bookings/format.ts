import { zonedDateKey, zonedTimeLabel } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { CANCELLATION_NOTICE_HOURS } from "./status";
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

/**
 * e.g. `("...T15:00:00.000Z", "...T15:30:00.000Z", "America/Chicago")` ->
 * `"Tuesday, August 18, 2026, 10:00–10:30am"` -- "My Appointments"
 * (TICKET-09; wireframe Screen 3) card's date+time line. Built from the
 * same zoned-conversion + full-date helpers `BookingConfirmPanel`'s own
 * (unexported) `formatSlotRange` already uses -- duplicated here rather
 * than imported from there, since that helper belongs to a different
 * ticket's component and isn't exported (matching this codebase's existing
 * precedent of small per-screen formatting duplication, e.g.
 * `formatBookingTimeRange` itself vs. `SlotBrowser`/`TimeSlotGrid`'s own
 * time formatting).
 */
export function formatAppointmentDateTime(
  startIso: string,
  endIso: string,
  timeZone: string
): string {
  const { year, month, day } = parseDateKey(zonedDateKey(startIso, timeZone));
  const dateLabel = formatFullDate(year, month, day);
  return `${dateLabel}, ${formatBookingTimeRange(startIso, endIso, timeZone)}`;
}

/**
 * e.g. `hoursUntilStart: 13.4` -> `"Starts in 14h — inside the 24h change
 * window. Call the office to change this visit."` -- matching the
 * wireframe's own framing (Screen 3) exactly, minus its leading lock icon
 * (rendered separately, `aria-hidden`, by the caller -- matching
 * `BookingStatusBadge`'s icon/text split). The hour count is always
 * rounded up (`Math.ceil`) so "13.4h left" reads as the safer "14h" rather
 * than an optimistic "13h", and clamped to zero rather than going negative
 * for the rare render where the start time has already passed by the time
 * this paints.
 */
export function formatCancellationNoticeMessage(hoursUntilStart: number): string {
  const hours = Math.max(0, Math.ceil(hoursUntilStart));
  return `Starts in ${hours}h — inside the ${CANCELLATION_NOTICE_HOURS}h change window. Call the office to change this visit.`;
}
