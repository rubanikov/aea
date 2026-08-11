"use client";

import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { SHORT_WEEKDAY_NAMES, formatWeekRange, weekDates } from "@/lib/bookings/week";

interface WeekStripProps {
  /** Monday of the visible week. */
  weekStartKey: string;
  selectedDay: string;
  /** Appointment count per dateKey, for this week only. A day with no
   * entry (rather than an explicit `0`) is treated as zero. */
  countsByDay: ReadonlyMap<string, number>;
  onSelectDay: (dateKey: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}

/**
 * Week navigation (prev/next/Today) plus a Monday-first day strip with
 * per-day appointment counts (Screen 8 of the wireframe). Each day is a
 * real `<button>` with a full-date-plus-count `aria-label` (e.g.
 * "Tuesday, August 18, 2026, 3 appointments") -- the same disambiguating-
 * label convention `AuditLogPagination`'s Prev/Next buttons already
 * established elsewhere in this codebase -- rather than a bare number a
 * screen reader would read out of context. The visible count is
 * `aria-hidden` since the label already carries it, so it isn't announced
 * twice.
 */
export function WeekStrip({
  weekStartKey,
  selectedDay,
  countsByDay,
  onSelectDay,
  onPrevWeek,
  onNextWeek,
  onToday,
}: WeekStripProps) {
  const days = weekDates(weekStartKey);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevWeek}
            aria-label="Go to previous week"
            className="rounded border border-gray-300 px-2 py-1 text-sm font-medium hover:bg-gray-50"
          >
            «
          </button>
          {/* Plain text, not a heading -- the one real `<h2>` per screen is
           * the selected day's date in `DayAgenda`; this is navigational
           * status ("which week am I looking at"), not a section title. */}
          <p className="text-base font-semibold">{formatWeekRange(weekStartKey)}</p>
          <button
            type="button"
            onClick={onNextWeek}
            aria-label="Go to next week"
            className="rounded border border-gray-300 px-2 py-1 text-sm font-medium hover:bg-gray-50"
          >
            »
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Today
        </button>
      </div>

      <div role="group" aria-label="Select a day" className="grid grid-cols-7 gap-2">
        {days.map((day, index) => {
          const { year, month, day: dayOfMonth } = parseDateKey(day);
          const count = countsByDay.get(day) ?? 0;
          const selected = day === selectedDay;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-pressed={selected}
              aria-label={`${formatFullDate(year, month, dayOfMonth)}, ${count} appointment${count === 1 ? "" : "s"}`}
              className={`flex flex-col items-center gap-1 rounded border px-2 py-2 text-sm ${
                selected
                  ? "border-black bg-gray-100 font-semibold"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span aria-hidden="true">{SHORT_WEEKDAY_NAMES[index]}</span>
              <span aria-hidden="true">{dayOfMonth}</span>
              <span aria-hidden="true" className="text-xs text-gray-500">
                {count === 0 ? "–" : count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
