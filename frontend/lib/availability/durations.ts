/**
 * Slot-length choices and duration display helpers. Every appointment
 * type is either a 30- or a 60-minute slot — a provider choice made per
 * type (`SLOT_DURATION_OPTIONS` mirrors the backend's
 * `AppointmentType.DURATION_CHOICES_MINUTES` and its DB
 * `CheckConstraint`). Display still renders whatever the API sends rather
 * than hardcoding either value, so the formatters stay simple value-in,
 * label-out functions.
 */

/** The two slot lengths a provider can choose for an appointment type. */
export const SLOT_DURATION_OPTIONS = [30, 60] as const;

export type SlotDuration = (typeof SLOT_DURATION_OPTIONS)[number];

/** The backend's default when no duration is sent — used to seed the
 * create form's radio group. */
export const DEFAULT_SLOT_DURATION: SlotDuration = 60;

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
