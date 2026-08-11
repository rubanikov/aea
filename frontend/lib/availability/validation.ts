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

/** The blocked-time add form's local field state: label plus a "From"/"To"
 * date and time, each entered in the provider's own timezone (converted to
 * a UTC ISO instant at submit time -- see `lib/availability/timezone.ts`). */
export interface BlockedTimeFormValues {
  label: string;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
}

export type BlockedTimeFieldErrors = {
  fromDate?: string;
  fromTime?: string;
  toDate?: string;
  toTime?: string;
  /** Set when every individual field is present but the range itself is
   * backwards -- kept separate from the per-field errors above so it can be
   * shown once, next to the range, rather than duplicated on both fields. */
  range?: string;
};

/**
 * Validates the blocked-time add form: every field required, then (only
 * once all four are present) "to" must be strictly after "from". Comparing
 * the "YYYY-MM-DDTHH:MM" strings directly is safe here -- both are wall-clock
 * values in the same (provider's) timezone, so lexical and chronological
 * order agree without needing to resolve either to an actual instant.
 */
export function validateBlockedTimeForm(
  values: BlockedTimeFormValues
): BlockedTimeFieldErrors {
  const errors: BlockedTimeFieldErrors = {};

  if (!values.fromDate) {
    errors.fromDate = "From date is required";
  }
  if (!values.fromTime) {
    errors.fromTime = "From time is required";
  }
  if (!values.toDate) {
    errors.toDate = "To date is required";
  }
  if (!values.toTime) {
    errors.toTime = "To time is required";
  }

  if (Object.keys(errors).length === 0) {
    const from = `${values.fromDate}T${values.fromTime}`;
    const to = `${values.toDate}T${values.toTime}`;
    if (to <= from) {
      errors.range = "End must be after start";
    }
  }

  return errors;
}
