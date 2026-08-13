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

/** One time block within a day of the working-hours form. `key` is a
 * client-only React key (never sent to the API), so removing a block in
 * the middle of a day's stack doesn't re-key its neighbours' inputs. */
export interface WorkingHoursBlock {
  key: string;
  startTime: string;
  endTime: string;
}

/** One weekday of the working-hours form's local UI state: a checkbox
 * plus a stack of one or more time blocks. */
export interface WorkingHoursDay {
  day: DayOfWeek;
  enabled: boolean;
  blocks: WorkingHoursBlock[];
}

/** Minimum minutes between the end of one block and the start of the
 * next on the same day. Exactly 60 is valid; 59 or touching is not. */
const MIN_BLOCK_GAP_MINUTES = 60;

/** "HH:MM" -> minutes since midnight. Also handles "HH:MM:SS" (DRF's
 * default `TimeField` serialization) by ignoring the seconds portion. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Tolerates "HH:MM:SS" (DRF's default `TimeField` serialization) as well
 * as "HH:MM" (what `<input type="time">` uses). */
export function normalizeTime(value: string): string {
  return value.length > 5 ? value.slice(0, 5) : value;
}

function validateDayBlocks(blocks: readonly WorkingHoursBlock[]): string | null {
  for (const block of blocks) {
    if (toMinutes(block.endTime) <= toMinutes(block.startTime)) {
      return "End time must be after start time.";
    }
  }

  const sorted = [...blocks].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    const gap = toMinutes(next.startTime) - toMinutes(previous.endTime);
    if (gap < 0) {
      return "These blocks overlap. Blocks on the same day can't share any time.";
    }
    if (gap < MIN_BLOCK_GAP_MINUTES) {
      return `Blocks must be at least 1 hour apart. There are only ${gap} minutes between ${previous.endTime} and ${next.startTime}.`;
    }
  }

  return null;
}

/**
 * Validates every *enabled* day's blocks, returning one specific message
 * per invalid day (never a single form-level error) so each day can show
 * its own inline error under the blocks that are actually wrong.
 * Disabled days aren't validated, since an unavailable day has no time
 * range to be wrong about.
 *
 * Per day, in order: every block needs `end > start`; then no two blocks
 * may overlap; then consecutive blocks need at least one hour between
 * one's end and the next's start (touching blocks — a 0-minute gap — are
 * invalid, exactly one hour is valid). The gap message interpolates the
 * real gap and times, per the wireframe copy.
 */
export function validateWorkingHours(
  days: readonly WorkingHoursDay[]
): Partial<Record<DayOfWeek, string>> {
  const errors: Partial<Record<DayOfWeek, string>> = {};

  for (const day of days) {
    if (!day.enabled) {
      continue;
    }
    const error = validateDayBlocks(day.blocks);
    if (error) {
      errors[day.day] = error;
    }
  }

  return errors;
}

/** The blocked-time add form's local field state: label plus a "From"/"To"
 * date and time, each entered in the provider's own timezone (converted to
 * a UTC ISO instant at submit time; see `lib/availability/timezone.ts`). */
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
   * backwards. Kept separate from the per-field errors above so it can be
   * shown once, next to the range, rather than duplicated on both fields. */
  range?: string;
};

/**
 * Validates the blocked-time add form: every field required, then (only
 * once all four are present) "to" must be strictly after "from". Comparing
 * the "YYYY-MM-DDTHH:MM" strings directly is safe here: both are wall-clock
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
