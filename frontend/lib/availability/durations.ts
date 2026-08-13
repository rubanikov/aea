/**
 * Duration display helpers. Every appointment is a fixed 60-minute slot —
 * the server always returns `duration_minutes: 60` and there is no picker
 * anymore — but display still renders whatever the API sends rather than
 * hardcoding "60", so these stay simple value-in, label-out formatters.
 */

/** Renders a duration for display, e.g. `60` -> `"60 minutes"`. */
export function formatDuration(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** Short "N min" form for compact contexts, e.g. the patient-facing
 * appointment-type picker's "Consultation (60 min)", distinct from
 * `formatDuration`'s full-word "60 minutes" used in the provider's own
 * appointment-type list. */
export function formatDurationShort(minutes: number): string {
  return `${minutes} min`;
}
