/**
 * Whether `startTimeIso`'s instant is at or before `now` -- the guard
 * behind "Mark no-show" being disabled until an appointment has actually
 * started (TICKET-08's accept criteria: "no_show only settable on a
 * confirmed booking whose start time has passed"). `now` defaults to the
 * real clock but is a parameter so tests can pin it rather than depending
 * on the real wall clock racing a fixed fixture's start time.
 */
export function hasBookingStartPassed(startTimeIso: string, now: Date = new Date()): boolean {
  return new Date(startTimeIso).getTime() <= now.getTime();
}
