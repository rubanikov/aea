/**
 * Pure block-positioning math for the week grid's day columns: given a
 * day's bookings and the grid's visible hour range, where does each block
 * sit vertically (top/height) and horizontally (side-by-side lanes for
 * overlapping bookings)?
 *
 * All geometry is returned as PERCENTAGES of the day column (top/height of
 * the column's full visible-hour height, left/width of its width), so the
 * rendering layer stays free to pick any pixel height per hour.
 *
 * DST-safe by construction: a block's start and end are each converted
 * independently into the target timezone's wall clock (via `Intl`), never
 * derived from one another through a UTC duration — a booking spanning a
 * DST transition is not a fixed number of wall-clock hours tall.
 */

import { zonedDateKey } from "@/lib/availability/timezone";
import type { HourRange } from "./hours";

export interface CalendarEventInput {
  id: number;
  /** UTC ISO instants, as the bookings API returns them. */
  start_time: string;
  end_time: string;
}

export interface BlockGeometry {
  /** % offset from the top of the visible-hour column. */
  topPercent: number;
  /** % of the visible-hour column's height. */
  heightPercent: number;
  /** % offset from the left of the day column (overlap lane). */
  leftPercent: number;
  /** % of the day column's width (100 for a booking with no overlaps). */
  widthPercent: number;
}

/** Wall-clock minutes since midnight of a UTC instant in `timeZone`. */
function zonedMinutesOfDay(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(lookup.hour) * 60 + Number(lookup.minute);
}

interface Timed {
  id: number;
  startMin: number;
  endMin: number;
  lane: number;
}

export interface BlockedRegionGeometry {
  /** % offset from the top of the visible-hour column. */
  topPercent: number;
  /** % of the visible-hour column's height. */
  heightPercent: number;
  /** Wall-clock minutes since midnight of the CLIPPED (visible) start —
   * what the region actually shows after truncation to this day column
   * and the grid's visible hours, for the accessible label. */
  clippedStartMin: number;
  /** Wall-clock minutes since midnight of the clipped (visible) end;
   * 1440 = midnight at the bottom of the column. */
  clippedEndMin: number;
}

/**
 * Positions ONE blocked-time range within ONE day column, or `null` when
 * none of it is visible there (it doesn't touch `dayKey`, or the visible
 * part falls entirely outside `range`). A multi-day block gets a separate
 * region per day column — the caller invokes this once per visible day —
 * never one region spanning columns.
 *
 * Shares `layoutDayBlocks`'s DST-safety rule: the block's start and end
 * are each converted independently into `timeZone`'s wall clock, never
 * derived from one another through a UTC duration. Unlike bookings,
 * blocked regions don't lane: they always span the full column width
 * (they render beneath the booking blocks, not beside them).
 */
export function layoutBlockedRegion(
  block: { start: string; end: string },
  dayKey: string,
  timeZone: string,
  range: HourRange
): BlockedRegionGeometry | null {
  const startDayKey = zonedDateKey(block.start, timeZone);
  const endDayKey = zonedDateKey(block.end, timeZone);
  if (startDayKey > dayKey || endDayKey < dayKey) {
    return null;
  }

  // A block starting on an earlier day covers this column from midnight;
  // one ending on a later day runs to the bottom (24:00).
  const startMin = startDayKey < dayKey ? 0 : zonedMinutesOfDay(block.start, timeZone);
  const endMin = endDayKey > dayKey ? 24 * 60 : zonedMinutesOfDay(block.end, timeZone);

  const clippedStartMin = Math.max(startMin, range.startHour * 60);
  const clippedEndMin = Math.min(endMin, range.endHour * 60);
  if (clippedEndMin <= clippedStartMin) {
    // Ends exactly at this day's midnight, or sits entirely outside the
    // visible hours: nothing to paint here.
    return null;
  }

  const rangeStartMin = range.startHour * 60;
  const totalMin = (range.endHour - range.startHour) * 60;
  return {
    topPercent: ((clippedStartMin - rangeStartMin) / totalMin) * 100,
    heightPercent: ((clippedEndMin - clippedStartMin) / totalMin) * 100,
    clippedStartMin,
    clippedEndMin,
  };
}

/**
 * Positions every event on `dayKey`'s column. Events are expected to be
 * the ones already bucketed under `dayKey` by `zonedDateKey(start_time)`;
 * one whose end crosses midnight is clamped to the bottom of the day.
 *
 * Overlapping events are laid out side-by-side: transitively-overlapping
 * runs form a cluster, events within a cluster are assigned to the first
 * free lane (greedy, in start order), and every event in the cluster
 * shares the column width evenly across the cluster's lane count.
 */
export function layoutDayBlocks(
  events: readonly CalendarEventInput[],
  dayKey: string,
  timeZone: string,
  range: HourRange
): Map<number, BlockGeometry> {
  const rangeStartMin = range.startHour * 60;
  const totalMin = (range.endHour - range.startHour) * 60;

  const timed: Timed[] = events.map((event) => {
    const startMin = zonedMinutesOfDay(event.start_time, timeZone);
    const crossesMidnight = zonedDateKey(event.end_time, timeZone) !== dayKey;
    let endMin = crossesMidnight ? 24 * 60 : zonedMinutesOfDay(event.end_time, timeZone);
    if (endMin <= startMin) {
      // Degenerate (zero-length data, or a fall-back DST transition
      // collapsing the wall-clock span): keep a sliver visible rather
      // than a zero-height or negative-height block.
      endMin = startMin + 15;
    }
    return { id: event.id, startMin, endMin, lane: 0 };
  });

  timed.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const geometry = new Map<number, BlockGeometry>();

  // Split into clusters of transitively-overlapping events, then lay each
  // cluster out over its own lane count.
  let cluster: Timed[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  function flushCluster() {
    if (cluster.length === 0) {
      return;
    }
    const laneEnds: number[] = [];
    for (const event of cluster) {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= event.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(event.endMin);
      } else {
        laneEnds[lane] = event.endMin;
      }
      event.lane = lane;
    }
    const widthPercent = 100 / laneEnds.length;
    for (const event of cluster) {
      const top = ((event.startMin - rangeStartMin) / totalMin) * 100;
      const bottom = ((event.endMin - rangeStartMin) / totalMin) * 100;
      const clampedTop = Math.max(0, Math.min(100, top));
      const clampedBottom = Math.max(clampedTop, Math.min(100, bottom));
      geometry.set(event.id, {
        topPercent: clampedTop,
        heightPercent: clampedBottom - clampedTop,
        leftPercent: event.lane * widthPercent,
        widthPercent,
      });
    }
    cluster = [];
  }

  for (const event of timed) {
    if (event.startMin >= clusterEnd) {
      flushCluster();
      clusterEnd = event.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, event.endMin);
    }
    cluster.push(event);
  }
  flushCluster();

  return geometry;
}
