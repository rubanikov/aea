import { parseDateKey } from "@/lib/scheduling/calendar";
import { SHORT_WEEKDAY_NAMES } from "@/lib/bookings/week";
import { cn } from "@/lib/utils";

interface WeekGridHeaderProps {
  /** The 7 dateKeys of the visible week, Monday first. */
  days: readonly string[];
  /** Today's dateKey in the provider's timezone, for the today
   * treatment; `null` when unknown. */
  todayKey: string | null;
}

/**
 * The day-of-week + date header row across the top of the week grid.
 * Rendered with the same `3.5rem + 7 columns` template as the grid body
 * so the columns line up. Today's column is visually marked
 * (`--grid-today-bg` + a "Today" tag) and carries `aria-current="date"`.
 */
export function WeekGridHeader({ days, todayKey }: WeekGridHeaderProps) {
  return (
    <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-(--grid-line-strong) text-center text-xs">
      <div aria-hidden="true" />
      {days.map((day, index) => {
        const { day: dayOfMonth } = parseDateKey(day);
        const isToday = day === todayKey;
        return (
          <div
            key={day}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "border-l border-(--grid-line) px-1 py-1.5",
              isToday && "bg-(--grid-today-bg) font-semibold"
            )}
          >
            <span className="block">
              {SHORT_WEEKDAY_NAMES[index]} {dayOfMonth}
            </span>
            {isToday ? (
              <span className="block text-[10px] tracking-wide text-primary uppercase">
                Today
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
