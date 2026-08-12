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
    return `${base} bg-(--slot-selected-bg) font-semibold text-(--slot-selected-foreground)`;
  }
  if (options.selectable) {
    return `${base} font-semibold text-foreground hover:bg-accent`;
  }
  // Unavailable days (past or fully booked) share the same diagonal-hatch
  // texture the provider calendar uses for blocked time (`globals.css`'s
  // `.hatch-unavailable`), so "not bookable" reads identically on both
  // sides of the app.
  return `${base} hatch-unavailable ${
    options.inCurrentMonth ? "text-muted-foreground" : "text-muted-foreground/60"
  }`;
}

/**
 * The "Pick a date" month calendar: a fixed 6-week Sunday-first grid with
 * month navigation. Bookable days (bold, real `aria-pressed` buttons) vs.
 * past/fully-booked days (hatched, via the shared `.hatch-unavailable`
 * utility) are both real, focusable `<button>`s. A hatched day is
 * `aria-disabled`, not the native `disabled` attribute, so it stays in the
 * tab order rather than being skipped entirely.
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
          className="rounded border border-border-strong px-2 py-1 text-sm hover:bg-accent"
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
          className="rounded border border-border-strong px-2 py-1 text-sm hover:bg-accent"
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
            className="pb-1 text-center text-xs font-medium text-muted-foreground"
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

      <p className="text-xs text-muted-foreground">
        Bold = has open slots. Hatched = fully booked or in the past (not bookable).
      </p>
    </div>
  );
}
