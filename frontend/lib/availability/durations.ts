/**
 * Curated preset durations (in minutes) for the appointment-type duration
 * picker. A closed list of sane presets, rather than a free-entry number
 * input, keeps every value a clearly labeled, valid duration ("45
 * minutes", never a bare "45" or something like "7"). Covers short
 * follow-ups (~10-15 min) through physicals (45-60 min), with headroom
 * above.
 */
export const DURATION_OPTIONS: readonly number[] = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120,
];

/** Renders a duration for display, e.g. `45` -> `"45 minutes"`. */
export function formatDuration(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** Short "N min" form for compact contexts, e.g. the patient-facing
 * appointment-type picker's "Follow-up (15 min)", distinct from
 * `formatDuration`'s full-word "15 minutes" used in the provider's own
 * appointment-type list. */
export function formatDurationShort(minutes: number): string {
  return `${minutes} min`;
}

/** `DURATION_OPTIONS`, plus `current` if it isn't already in the list.
 * Mirrors `lib/timezones.ts`'s `timezoneOptions` so an unusual value from
 * the backend (or a type created before the preset list changed) is never
 * silently dropped from the picker. */
export function durationOptions(current: number | undefined): readonly number[] {
  if (current === undefined || DURATION_OPTIONS.includes(current)) {
    return DURATION_OPTIONS;
  }
  return [...DURATION_OPTIONS, current].sort((a, b) => a - b);
}
