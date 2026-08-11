"use client";

import { zonedTimeLabel } from "@/lib/availability/timezone";
import type { Slot } from "@/lib/scheduling/types";

interface TimeSlotGridProps {
  /** Every open slot on the selected date, already sorted by start time. */
  slots: readonly Slot[];
  patientTimeZone: string;
  /** e.g. "Tuesday, August 18, 2026", for the heading and empty-state copy. */
  selectedDateLabel: string;
  isToday: boolean;
  /** Wired to open `SlotBrowser`'s `BookingConfirmPanel` for the clicked
   * slot; this component itself stays booking-agnostic, just a real,
   * clickable `<button>` per slot. */
  onSelectSlot: (slot: Slot) => void;
}

/**
 * The "Times for {date}" slot-button grid, plus its two empty states: no
 * slots left today vs. no open slots on a date that hasn't happened yet.
 * Each button shows the slot's start time converted into the patient's
 * own zone via `lib/availability/timezone.ts`'s `zonedTimeLabel`, never
 * the raw UTC value the API returns.
 */
export function TimeSlotGrid({
  slots,
  patientTimeZone,
  selectedDateLabel,
  isToday,
  onSelectSlot,
}: TimeSlotGridProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Times for {selectedDateLabel}</h2>

      {slots.length === 0 ? (
        <p className="text-sm text-gray-600">
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
          {slots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              onClick={() => onSelectSlot(slot)}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {zonedTimeLabel(slot.start, patientTimeZone)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
