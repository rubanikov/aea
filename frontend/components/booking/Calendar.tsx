"use client";

import {
  WEEKDAY_HEADERS,
  formatFullDate,
  formatMonthYear,
  monthGrid,
  type CalendarDay,
  type YearMonth,
} from "@/lib/scheduling/calendar";

interface CalendarProps {
  visibleMonth: YearMonth;
  selectedDateKey: string;
  /** Patient-local "today", as a `dateKey`; any grid day before this is
   * in the past. */
  todayKey: string;
  /** Every `dateKey` (in the patient's own zone) that has at least one open
   * slot in the currently-loaded date range. */
  datesWithSlots: ReadonlySet<string>;
  onSelectDate: (dateKey: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

function dayAriaLabel(day: CalendarDay, selectable: boolean, isPast: boolean): string {
  const full = formatFullDate(day.year, day.month, day.day);
  if (selectable) {
    return `${full}, has open slots`;
  }
  return isPast ? `${full}, in the past, not bookable` : `${full}, fully booked, not bookable`;
}

function dayClassName(options: {
  inCurrentMonth: boolean;
  selectable: boolean;
  isSelected: boolean;
}): string {
  const base = "rounded px-2 py-1.5 text-center text-sm";
  if (options.isSelected && options.selectable) {
    return `${base} bg-black font-semibold text-white`;
  }
  if (options.selectable) {
    return `${base} font-semibold text-black hover:bg-gray-100`;
  }
  return `${base} ${options.inCurrentMonth ? "text-gray-400" : "text-gray-300"}`;
}

/**
 * The "Pick a date" month calendar: a fixed 6-week Sunday-first grid with
 * month navigation. Bookable days (bold, real `aria-pressed` buttons) vs.
 * past/fully-booked days (dimmed) are both real, focusable `<button>`s. A
 * dimmed day is `aria-disabled`, not the native `disabled` attribute, so
 * it stays in the tab order rather than being skipped entirely.
 */
export function Calendar({
  visibleMonth,
  selectedDateKey,
  todayKey,
  datesWithSlots,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: CalendarProps) {
  const grid = monthGrid(visibleMonth);
  const monthLabel = formatMonthYear(visibleMonth);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Pick a date</h2>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
        >
          «
        </button>
        <p aria-live="polite" className="font-medium">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="Next month"
          className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
        >
          »
        </button>
      </div>

      <div
        role="group"
        aria-label={`Calendar for ${monthLabel}`}
        className="grid grid-cols-7 gap-1"
      >
        {WEEKDAY_HEADERS.map((header) => (
          <div
            key={header}
            aria-hidden="true"
            className="pb-1 text-center text-xs font-medium text-gray-500"
          >
            {header}
          </div>
        ))}
        {grid.map((day) => {
          const hasSlots = datesWithSlots.has(day.dateKey);
          const isPast = day.dateKey < todayKey;
          const selectable = hasSlots;
          const isSelected = day.dateKey === selectedDateKey;

          return (
            <button
              key={day.dateKey}
              type="button"
              onClick={() => {
                if (selectable) {
                  onSelectDate(day.dateKey);
                }
              }}
              aria-disabled={!selectable}
              aria-pressed={isSelected}
              aria-label={dayAriaLabel(day, selectable, isPast)}
              className={dayClassName({
                inCurrentMonth: day.inCurrentMonth,
                selectable,
                isSelected,
              })}
            >
              {day.day}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Bold = has open slots. Dimmed = fully booked or in the past (not bookable).
      </p>
    </div>
  );
}
