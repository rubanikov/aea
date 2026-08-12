"use client";

import { useState } from "react";
import {
  WEEKDAY_HEADERS,
  addMonths,
  formatFullDate,
  formatMonthYear,
  monthGrid,
  parseDateKey,
  type YearMonth,
} from "@/lib/scheduling/calendar";
import { weekDates } from "@/lib/bookings/week";
import { cn } from "@/lib/utils";

interface MiniMonthProps {
  /** Monday of the currently visible week; clicking any mini-month day
   * jumps the main grid to that day's week. */
  weekStartKey: string;
  todayKey: string | null;
  onSelectDay: (dateKey: string) => void;
  /** Days to mark as having open slots (patient slot picker): a marked day
   * renders bold with a dot and carries ", has open slots" in its
   * accessible name, matching the retired patient month-calendar's
   * convention. Omitted by the provider calendar, which renders exactly as
   * before. */
  markedDays?: ReadonlySet<string>;
}

/**
 * The sidebar mini month-calendar for quick date/week jumping, built on
 * the same `monthGrid` math as the patient date picker (Sunday-first,
 * fixed 42 cells) rather than new month arithmetic. The visible week's
 * days are highlighted; clicking any day calls `onSelectDay`, which jumps
 * the main grid to that day's week.
 *
 * The visible month is local state seeded from `weekStartKey`; the parent
 * mounts this with `key={weekStartKey}` so week navigation in the main
 * grid re-seeds the mini month to follow along, without this component
 * needing derived-state effects.
 */
export function MiniMonth({ weekStartKey, todayKey, onSelectDay, markedDays }: MiniMonthProps) {
  const { year, month } = parseDateKey(weekStartKey);
  const [visibleMonth, setVisibleMonth] = useState<YearMonth>({ year, month });
  const visibleWeek = new Set(weekDates(weekStartKey));
  const grid = monthGrid(visibleMonth);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{formatMonthYear(visibleMonth)}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
            aria-label="Previous month"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-accent"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            aria-label="Next month"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-accent"
          >
            »
          </button>
        </div>
      </div>
      <div role="group" aria-label="Jump to a week" className="grid grid-cols-7 text-center text-xs">
        {WEEKDAY_HEADERS.map((header) => (
          <span key={header} aria-hidden="true" className="py-1 text-muted-foreground">
            {header}
          </span>
        ))}
        {grid.map((cell) => {
          const inVisibleWeek = visibleWeek.has(cell.dateKey);
          const isToday = cell.dateKey === todayKey;
          const marked = markedDays?.has(cell.dateKey) ?? false;
          const fullDate = formatFullDate(cell.year, cell.month, cell.day);
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onSelectDay(cell.dateKey)}
              aria-label={marked ? `${fullDate}, has open slots` : fullDate}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "relative rounded py-1 hover:bg-accent",
                !cell.inCurrentMonth && "text-muted-foreground",
                marked && "font-semibold",
                inVisibleWeek && "bg-(--slot-selected-bg) text-(--slot-selected-foreground) hover:bg-(--slot-selected-bg)",
                isToday && !inVisibleWeek && "font-bold text-primary"
              )}
            >
              {cell.day}
              {marked ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-px text-[7px] leading-none text-primary"
                >
                  ●
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
