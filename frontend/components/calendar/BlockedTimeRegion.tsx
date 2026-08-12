import type { BlockedRegionGeometry } from "@/lib/calendar/layout";

/**
 * `("HH*60+MM" minutes since midnight)` -> `"9:00am"` / `"12:30pm"`,
 * matching `zonedTimeLabel`'s rendering (12-hour, lowercase suffix, no
 * leading zero). A local wall-clock formatter rather than a reuse of
 * `zonedTimeLabel` itself because a CLIPPED endpoint (truncated at the
 * grid edge) is a wall-clock minute of the grid, not any real UTC
 * instant that could round-trip through `Intl`.
 */
function minutesLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24; // 1440 (bottom of column) -> midnight
  const minute = minutes % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 < 12 ? "am" : "pm";
  return `${hour12}:${String(minute).padStart(2, "0")}${period}`;
}

/** Same range convention as `formatBookingTimeRange`: the start's am/pm is
 * dropped when both ends share it (`"9:00–11:00am"`), kept when the range
 * crosses noon (`"10:00am–12:00pm"`). Exported for the patient slot
 * picker's `UnavailableRegion`, which renders the same clipped-minutes
 * geometry with patient-facing copy ("Unavailable" rather than
 * "Blocked"). */
export function minutesRangeLabel(startMin: number, endMin: number): string {
  const start = minutesLabel(startMin);
  const end = minutesLabel(endMin);
  return start.slice(-2) === end.slice(-2)
    ? `${start.slice(0, -2)}–${end}`
    : `${start}–${end}`;
}

interface BlockedTimeRegionProps {
  /** `""` for an unlabeled block (see `BlockedTime.label`). */
  label: string;
  geometry: BlockedRegionGeometry;
}

/**
 * One clipped hatched region for a blocked-time range within a single day
 * column — a multi-day block renders one of these per column it overlaps
 * (see `layoutBlockedRegion`). Purely visual this pass: no click handler,
 * no hover, no focus stop, and `pointer-events: none` so it never
 * intercepts a click meant for a booking block rendered on top of it or
 * for the grid background. Screen readers get a visually-hidden sibling
 * naming the CLIPPED (visible) range instead of the `aria-hidden` texture.
 */
export function BlockedTimeRegion({ label, geometry }: BlockedTimeRegionProps) {
  const range = minutesRangeLabel(geometry.clippedStartMin, geometry.clippedEndMin);
  return (
    <>
      <div
        aria-hidden="true"
        className="hatch-unavailable pointer-events-none absolute inset-x-0"
        style={{
          top: `${geometry.topPercent}%`,
          height: `${geometry.heightPercent}%`,
        }}
      />
      <span className="sr-only">
        {label ? `Blocked: ${label}, ${range}` : `Blocked, ${range}`}
      </span>
    </>
  );
}
