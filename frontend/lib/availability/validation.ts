import type { DayOfWeek } from "./days";
import type { AppointmentTypeInput } from "./types";

/** Field name -> a single, specific inline error message (mirrors
 * `lib/auth/validation.ts`'s `FieldErrors`, scoped to this form). */
export type AppointmentTypeFieldErrors = { name?: string };

export function validateAppointmentType(
  values: AppointmentTypeInput
): AppointmentTypeFieldErrors {
  const errors: AppointmentTypeFieldErrors = {};

  if (!values.name.trim()) {
    errors.name = "Name is required";
  }

  return errors;
}

/** One weekday row of the working-hours form's local UI state. */
export interface WorkingHoursRow {
  day: DayOfWeek;
  enabled: boolean;
  startTime: string;
  endTime: string;
}

/**
 * Validates every *enabled* row's time range, returning a specific message
 * per invalid day (never a single form-level error) so each row can show
 * its own inline error next to the fields that are actually wrong.
 * Disabled days aren't validated -- an unavailable day has no time range to
 * be wrong about. "HH:MM" 24-hour strings compare correctly with `<=`.
 */
export function validateWorkingHours(
  rows: readonly WorkingHoursRow[]
): Partial<Record<DayOfWeek, string>> {
  const errors: Partial<Record<DayOfWeek, string>> = {};

  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }
    if (row.endTime <= row.startTime) {
      errors[row.day] = "End time must be after start time";
    }
  }

  return errors;
}
