/**
 * Weekday vocabulary for the provider's weekly working-hours form. Values
 * are lowercase day names for use in this app's own state/props; the wire
 * format (`Availability.day_of_week`) is an integer, Monday=0...Sunday=6 --
 * matching Python's `date.weekday()`, confirmed against
 * `backend/scheduling/models.py`. `WEEKDAYS` below is deliberately in that
 * same Monday-first order so its array index doubles as the wire integer;
 * see `dayOfWeekToIndex`/`dayOfWeekFromIndex`.
 */
export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface WeekdayOption {
  value: DayOfWeek;
  label: string;
}

/** Monday-first order, matching the wireframe (Screen 5) and the working
 * week providers actually think in. */
export const WEEKDAYS: readonly WeekdayOption[] = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

/** `DayOfWeek` -> the backend's `Availability.day_of_week` integer. */
export function dayOfWeekToIndex(day: DayOfWeek): number {
  return WEEKDAYS.findIndex((weekday) => weekday.value === day);
}

/** The backend's `Availability.day_of_week` integer -> `DayOfWeek`,
 * `undefined` for an out-of-range value. */
export function dayOfWeekFromIndex(index: number): DayOfWeek | undefined {
  return WEEKDAYS[index]?.value;
}
