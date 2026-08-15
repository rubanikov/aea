"use client";

import { zonedTimeLabel } from "@/lib/availability/timezone";
import type { Slot } from "@/lib/scheduling/types";

interface TimeSlotGridProps {
  /** Every open slot on the selected date, already sorted by start time. */
  slots: readonly Slot[];
  /** The provider's own IANA zone -- the clock the schedule itself is kept
   * on (their working hours, their calendar, their blocked time), so it's
   * the one every slot is *labelled* in. */
  scheduleTimeZone: string;
  /** The viewer's own zone, shown alongside each label whenever the two
   * differ, so a slot is never ambiguous about which clock it means. */
  viewerTimeZone: string;
  /** e.g. "Tuesday, August 18, 2026", for the heading and empty-state copy. */
  selectedDateLabel: string;
  isToday: boolean;
  /** The caller (`RescheduleDialog`) decides what a click means; this
   * component itself stays booking-agnostic, just a real, clickable
   * `<button>` per slot. */
  onSelectSlot: (slot: Slot) => void;
}

/**
 * The "Times for {date}" slot-button grid, plus its two empty states: no
 * slots left today vs. no open slots on a date that hasn't happened yet.
 *
 * Each button's primary label is the slot's start time in
 * `scheduleTimeZone` -- the provider's zone -- with the viewer's own local
 * time underneath when the two zones differ. Labelling primarily in the
 * viewer's zone instead would mean the same appointment reads as a
 * different o'clock here than it does on the provider's calendar and in
 * their working-hours settings, which is precisely the disagreement this
 * grid exists to render correctly. Both are converted from the API's UTC
 * instant via `lib/availability/timezone.ts`'s `zonedTimeLabel`; the raw
 * UTC value is never shown.
 */
export function TimeSlotGrid({
  slots,
  scheduleTimeZone,
  viewerTimeZone,
  selectedDateLabel,
  isToday,
  onSelectSlot,
}: TimeSlotGridProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Times for {selectedDateLabel}</h2>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isToday
            ? "No slots left today. Try another date."
            : "No open slots on this date. Try another date."}
        </p>
      ) : (
        <div
          role="group"
          aria-label={`Available times for ${selectedDateLabel}`}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {slots.map((slot) => {
            const scheduleLabel = zonedTimeLabel(slot.start, scheduleTimeZone);
            const viewerLabel = zonedTimeLabel(slot.start, viewerTimeZone);
            // Compared as rendered labels, not as zone ids: two different
            // ids can name the same wall clock (America/New_York vs.
            // US/Eastern), and repeating an identical time back to the
            // viewer as "your time" reads like a mistake.
            const showViewerLabel = viewerLabel !== scheduleLabel;

            return (
              <button
                key={slot.start}
                type="button"
                onClick={() => onSelectSlot(slot)}
                aria-label={
                  showViewerLabel
                    ? `${scheduleLabel} (${viewerLabel} your time)`
                    : scheduleLabel
                }
                className="rounded border border-(--slot-open-border) bg-(--slot-open-bg) px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                {scheduleLabel}
                {showViewerLabel ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {viewerLabel} your time
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
