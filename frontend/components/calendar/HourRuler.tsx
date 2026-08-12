import type { HourRange } from "@/lib/calendar/hours";

/** `9` -> `"9 AM"`, `0` -> `"12 AM"`, `12` -> `"12 PM"`, `15` -> `"3 PM"`. */
export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour} ${period}`;
}

/**
 * The hour labels down the left edge of the week grid, one per visible
 * hour row. The hours themselves are wall-clock hours in whatever
 * timezone the grid's `HourRange` was computed for (the provider's own —
 * see `visibleHourRange`); this component just renders the numbers.
 * `aria-hidden`: each appointment block already carries its own full
 * time range, so the ruler is purely visual scaffolding.
 */
export function HourRuler({ range }: { range: HourRange }) {
  const hours = Array.from(
    { length: range.endHour - range.startHour },
    (_, index) => range.startHour + index
  );

  return (
    <div aria-hidden="true" className="text-right text-xs text-(--grid-hour-label)">
      {hours.map((hour) => (
        <div
          key={hour}
          className="h-14 border-t border-(--grid-line) pr-1.5 pt-0.5 first:border-t-0"
        >
          {formatHourLabel(hour)}
        </div>
      ))}
    </div>
  );
}
