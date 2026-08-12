import type { ReactNode } from "react";
import type { BlockedTime } from "@/lib/availability/types";
import type { HourRange } from "@/lib/calendar/hours";
import { layoutBlockedRegion } from "@/lib/calendar/layout";
import { cn } from "@/lib/utils";
import { BlockedTimeRegion } from "./BlockedTimeRegion";
import { HourRuler } from "./HourRuler";
import { WeekGridHeader } from "./WeekGridHeader";

/** Vertical scale: one hour of calendar = 3.5rem, matching `HourRuler`'s
 * `h-14` rows. Block geometry itself is percentage-based
 * (`lib/calendar/layout.ts`), so this is the only place the pixel scale
 * exists. */
const REM_PER_HOUR = 3.5;

interface TimeGridProps {
  /** The 7 dateKeys of the visible week, Monday first. */
  days: readonly string[];
  todayKey: string | null;
  range: HourRange;
  /** The positioned `AppointmentBlock`s (or anything absolutely
   * positioned in percentages) for one day column. */
  renderDay: (dateKey: string) => ReactNode;
  /** Optional overlay centered over the grid body (e.g. the empty-week
   * message), rendered on top of the gridlines so the calendar stays
   * recognizable as a calendar. */
  overlay?: ReactNode;
  /** Blocked-time ranges to hatch onto the grid, already filtered to the
   * visible week by the caller. Requires `timezone`. When absent (or
   * empty) the grid renders exactly as it does without this feature —
   * the patient slot picker reuses `TimeGrid` without passing it. */
  blockedTimes?: readonly BlockedTime[];
  /** The IANA zone blocked-time endpoints are converted into; only needed
   * alongside `blockedTimes`. */
  timezone?: string;
}

/**
 * The week-grid shell: hour ruler column plus 7 day columns with hour
 * gridlines, the Google-Calendar-style skeleton the provider calendar
 * (and later the patient slot picker) positions blocks onto. Pure
 * presentation — all data decisions (visible hours, block geometry) are
 * made by the caller with `lib/calendar/hours.ts` / `layout.ts`.
 */
export function TimeGrid({
  days,
  todayKey,
  range,
  renderDay,
  overlay,
  blockedTimes,
  timezone,
}: TimeGridProps) {
  const hourCount = range.endHour - range.startHour;
  const bodyHeight = `${hourCount * REM_PER_HOUR}rem`;

  return (
    <div className="min-w-0">
      <WeekGridHeader days={days} todayKey={todayKey} />
      <div className="relative">
        <div
          className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
          style={{ height: bodyHeight }}
        >
          <HourRuler range={range} />
          {days.map((day) => (
            <div
              key={day}
              className={cn(
                "relative border-l border-(--grid-line)",
                day === todayKey && "bg-(--grid-today-bg)"
              )}
            >
              {/* Hour gridlines, purely visual. */}
              <div aria-hidden="true" className="absolute inset-0">
                {Array.from({ length: hourCount }, (_, index) => (
                  <div
                    key={index}
                    className="h-14 border-t border-(--grid-line) first:border-t-0"
                  />
                ))}
              </div>
              {/* Blocked-time hatching sits BENEATH the day's blocks:
                  rendered first in DOM order (later absolutely-positioned
                  siblings paint on top) and pointer-events-none, so a
                  booking inside a blocked window stays fully visible and
                  clickable. */}
              {blockedTimes && timezone
                ? blockedTimes.map((block) => {
                    const region = layoutBlockedRegion(block, day, timezone, range);
                    return region ? (
                      <BlockedTimeRegion
                        key={block.id}
                        label={block.label}
                        geometry={region}
                      />
                    ) : null;
                  })
                : null}
              {renderDay(day)}
            </div>
          ))}
        </div>
        {overlay ? (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10">
            <div className="pointer-events-auto">{overlay}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
