import { zonedDateKey, zonedTimeLabel } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { CANCELLATION_NOTICE_HOURS } from "./status";
import type { BookingStatus } from "./types";

/**
 * Icon + text for each `BookingStatus` value. Status is always shown with
 * text/icon, never color alone (see `BookingStatusBadge`); other screens
 * that show a booking's status should reuse this rather than rolling
 * their own.
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
 * The same window on the *provider's* clock, for a patient-facing surface
 * that renders times on the patient's own — e.g. a 13:00Z appointment
 * shown to a UTC patient as `"1:00–2:00pm"` also reads `"9:00–10:00am"` on
 * an `America/New_York` provider's clock. `null` when both zones render
 * the range identically, so a screen never repeats the same time twice.
 *
 * A patient picks a slot off the provider's schedule, labelled in the
 * provider's zone (`components/booking/SlotBlock.tsx`) — so the number
 * they picked has to survive onto the screens they see afterwards.
 * Without it, booking "9:00am with Dr. Rossi" from Central time lands on
 * a calendar reading 8:00am, which looks like the appointment moved.
 * Compared as rendered ranges, not zone ids: two ids can name the same
 * wall clock (`America/New_York` vs. `US/Eastern`), the same rule
 * `SlotBlock` uses for its own second line.
 */
export function formatProviderClockRange(
  startIso: string,
  endIso: string,
  providerTimeZone: string,
  viewerTimeZone: string
): string | null {
  const providerRange = formatBookingTimeRange(startIso, endIso, providerTimeZone);
  const viewerRange = formatBookingTimeRange(startIso, endIso, viewerTimeZone);
  return providerRange === viewerRange ? null : providerRange;
}

/**
 * e.g. `("...T15:00:00.000Z", "...T15:30:00.000Z", "America/Chicago")` ->
 * `"Tuesday, August 18, 2026, 10:00–10:30am"`, the date+time line on a
 * "My Appointments" card. Built from the same zoned-conversion + full-date
 * helpers `BookingConfirmPanel`'s own (unexported) `formatSlotRange`
 * already uses; duplicated here rather than imported, since that helper
 * isn't exported and this codebase already has small per-screen
 * formatting duplication elsewhere (e.g. `formatBookingTimeRange` vs.
 * `SlotBrowser`/`TimeSlotGrid`'s own time formatting).
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
 * window. Call the office to change this visit."` The leading lock icon
 * is rendered separately, `aria-hidden`, by the caller, matching
 * `BookingStatusBadge`'s icon/text split. The hour count is always
 * rounded up (`Math.ceil`) so "13.4h left" reads as the safer "14h" rather
 * than an optimistic "13h", and clamped to zero rather than going negative
 * for the rare render where the start time has already passed by the time
 * this paints.
 */
export function formatCancellationNoticeMessage(hoursUntilStart: number): string {
  const hours = Math.max(0, Math.ceil(hoursUntilStart));
  return `Starts in ${hours}h — inside the ${CANCELLATION_NOTICE_HOURS}h change window. Call the office to change this visit.`;
}
