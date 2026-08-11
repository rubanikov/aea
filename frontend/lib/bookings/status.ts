import type { AppointmentTab, BookingStatus } from "./types";

/**
 * Whether `startTimeIso`'s instant is at or before `now`. This backs
 * "Mark no-show" staying disabled until an appointment has actually
 * started. `now` defaults to the real clock but is a parameter so tests
 * can pin it instead of racing the real wall clock against a fixed
 * fixture's start time.
 */
export function hasBookingStartPassed(startTimeIso: string, now: Date = new Date()): boolean {
  return new Date(startTimeIso).getTime() <= now.getTime();
}

/**
 * Minimum hours' notice a patient must give before an appointment's start
 * time to cancel it. Mirrored here so the UI can disable the Cancel button
 * and explain why before sending a request the server would reject
 * anyway; the real rule is enforced server-side, on `PATCH /bookings/:id/cancel`.
 */
export const CANCELLATION_NOTICE_HOURS = 24;

/**
 * Hours remaining until `startTimeIso`, relative to `now`, negative once
 * the appointment has started. Returned as a plain number, not
 * rounded or clamped, so callers can decide how to present it:
 * `isWithinCancellationNoticeWindow` compares it directly, and
 * `formatCancellationNoticeMessage` (`./format`) rounds it up for display.
 */
export function hoursUntilBookingStart(startTimeIso: string, now: Date = new Date()): number {
  return (new Date(startTimeIso).getTime() - now.getTime()) / (1000 * 60 * 60);
}

/**
 * Whether cancelling `startTimeIso` right now would fall inside the
 * `CANCELLATION_NOTICE_HOURS`-hour notice window. This is a client-side
 * mirror of the server's own rule, for immediate UI feedback (disabling
 * Cancel and explaining why) before a doomed request is ever sent. A
 * client clock running slightly behind the server's can't be fully closed
 * out by this check alone right at the boundary, which is why
 * `AppointmentCard` still surfaces the server's own rejection message on
 * a 400 rather than treating this check as authoritative.
 */
export function isWithinCancellationNoticeWindow(
  startTimeIso: string,
  now: Date = new Date()
): boolean {
  return hoursUntilBookingStart(startTimeIso, now) < CANCELLATION_NOTICE_HOURS;
}

/**
 * Which of "My Appointments"'s three tabs a booking belongs under.
 * `cancelled` status wins outright regardless of `start_time`: an
 * appointment cancelled well ahead of its original time is still a
 * cancelled appointment, not an upcoming one. Otherwise it's `past` once
 * its start time has passed (`hasBookingStartPassed`, reused as-is, since
 * a `completed`/`no_show` booking's start time has necessarily already
 * passed too under the server's own transition rules), else `upcoming`.
 */
export function classifyAppointmentTab(
  booking: { status: BookingStatus; start_time: string },
  now: Date = new Date()
): AppointmentTab {
  if (booking.status === "cancelled") {
    return "cancelled";
  }
  return hasBookingStartPassed(booking.start_time, now) ? "past" : "upcoming";
}
