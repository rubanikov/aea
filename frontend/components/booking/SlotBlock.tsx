"use client";

import { zonedTimeLabel } from "@/lib/availability/timezone";
import type { BlockGeometry } from "@/lib/calendar/layout";
import type { Slot } from "@/lib/scheduling/types";

interface SlotBlockProps {
  slot: Slot;
  /** The provider's own IANA zone — the clock the schedule itself is kept
   * on, so it's the one every slot is *labelled* in (see `DateTimeStep`'s
   * one-clock rule). */
  scheduleTimeZone: string;
  /** The viewer's own zone, shown as a second line whenever the two
   * rendered labels differ, so a slot is never ambiguous about which
   * clock it means. */
  viewerTimeZone: string;
  geometry: BlockGeometry;
  /** The patient picked this open slot; the wizard advances to Confirm. */
  onSelect: (slot: Slot) => void;
}

/**
 * One tappable open slot on the patient week grid: absolutely positioned
 * from `lib/calendar/layout.ts`'s percentage geometry (same convention as
 * the provider calendar's `AppointmentBlock`), styled with the shared
 * open-slot tokens.
 *
 * Label convention is identical to the retired `TimeSlotGrid` buttons: the
 * primary label is the slot's start in `scheduleTimeZone` — the provider's
 * zone — with the viewer's own local time underneath only when the two
 * RENDERED labels differ. Compared as rendered labels, not as zone ids:
 * two different ids can name the same wall clock (America/New_York vs.
 * US/Eastern), and repeating an identical time back to the viewer as
 * "your time" reads like a mistake. The accessible name always carries
 * both clocks even when a short block visually clips the second line.
 */
export function SlotBlock({
  slot,
  scheduleTimeZone,
  viewerTimeZone,
  geometry,
  onSelect,
}: SlotBlockProps) {
  const scheduleLabel = zonedTimeLabel(slot.start, scheduleTimeZone);
  const viewerLabel = zonedTimeLabel(slot.start, viewerTimeZone);
  const showViewerLabel = viewerLabel !== scheduleLabel;

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      aria-label={
        showViewerLabel ? `${scheduleLabel} (${viewerLabel} your time)` : scheduleLabel
      }
      style={{
        top: `${geometry.topPercent}%`,
        height: `${geometry.heightPercent}%`,
        left: `${geometry.leftPercent}%`,
        width: `${geometry.widthPercent}%`,
      }}
      className="absolute min-h-4 overflow-hidden rounded-sm border border-(--slot-open-border) bg-(--slot-open-bg) px-1 py-0.5 text-left text-xs leading-tight font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="block truncate" aria-hidden="true">
        {scheduleLabel}
      </span>
      {showViewerLabel ? (
        <span className="block truncate font-normal text-muted-foreground" aria-hidden="true">
          {viewerLabel} your time
        </span>
      ) : null}
    </button>
  );
}
