import type { ScheduleGeneration, ScheduleWindow } from "./types";

/**
 * Which weekly windows govern `dateKey` ("YYYY-MM-DD"): the pending
 * generation once that date is on or after its `effective_from`, otherwise
 * the live `current` generation. Same rule as
 * `scheduling.schedule.effective_generation_key` on the server.
 */
export function generationWindowsOnDate(
  current: ScheduleGeneration,
  pending: ScheduleGeneration | null,
  dateKey: string
): ScheduleWindow[] {
  if (pending?.effective_from != null && dateKey >= pending.effective_from) {
    return pending.windows;
  }
  return current.windows;
}

/**
 * Union of the windows that apply on any day in `dateKeys`. A week that
 * straddles a pending `effective_from` contributes both generations so the
 * hour grid is tall enough for every day it shows.
 */
export function generationWindowsInRange(
  current: ScheduleGeneration,
  pending: ScheduleGeneration | null,
  dateKeys: readonly string[]
): ScheduleWindow[] {
  const seen = new Set<string>();
  const windows: ScheduleWindow[] = [];
  for (const dateKey of dateKeys) {
    for (const window of generationWindowsOnDate(current, pending, dateKey)) {
      const key = `${window.day_of_week}|${window.start_time}|${window.end_time}`;
      if (!seen.has(key)) {
        seen.add(key);
        windows.push(window);
      }
    }
  }
  return windows;
}
