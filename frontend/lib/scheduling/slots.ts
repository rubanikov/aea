import { zonedDateKey } from "@/lib/availability/timezone";
import type { Slot } from "@/lib/scheduling/types";

/** Groups a flat slot list by the calendar date each slot's *start* falls
 * on in `timeZone`, sorted within each date by start time. Callers pass the
 * *provider's* zone: a slot belongs to the working day the provider's own
 * calendar files it under, so "Times for Wednesday" means the same day's
 * work on both sides of the app. Shared by the booking wizard's
 * `DateTimeStep` and `RescheduleDialog`, which needs the exact same
 * grouping over its own (differently-sourced) slot list; real
 * grouping/sorting logic, not a one-line formatter, so it's shared rather
 * than re-derived. (Moved here from the retired `SlotBrowser.tsx`.) */
export function groupSlotsByLocalDate(
  slots: readonly Slot[],
  timeZone: string
): Map<string, Slot[]> {
  const grouped = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = zonedDateKey(slot.start, timeZone);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(slot);
    } else {
      grouped.set(key, [slot]);
    }
  }
  for (const dateSlots of grouped.values()) {
    dateSlots.sort((a, b) => a.start.localeCompare(b.start));
  }
  return grouped;
}
