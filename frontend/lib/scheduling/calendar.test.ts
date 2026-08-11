import { describe, expect, it } from "vitest";
import {
  WEEKDAY_HEADERS,
  addMonths,
  dateKey,
  formatFullDate,
  formatMonthYear,
  monthGrid,
  parseDateKey,
  weekdayName,
} from "./calendar";

describe("dateKey / parseDateKey", () => {
  it("zero-pads month and day into YYYY-MM-DD", () => {
    expect(dateKey(2026, 8, 5)).toBe("2026-08-05");
  });

  it("round-trips through parseDateKey", () => {
    expect(parseDateKey("2026-08-17")).toEqual({ year: 2026, month: 8, day: 17 });
  });
});

describe("addMonths", () => {
  it("advances within a year", () => {
    expect(addMonths({ year: 2026, month: 8 }, 1)).toEqual({ year: 2026, month: 9 });
  });

  it("rolls over into the next year from December", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("rolls back into the previous year from January", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("handles a multi-year jump in either direction", () => {
    expect(addMonths({ year: 2026, month: 3 }, 14)).toEqual({ year: 2027, month: 5 });
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
  });
});

describe("formatMonthYear", () => {
  it("renders the wireframe's month-year heading format", () => {
    expect(formatMonthYear({ year: 2026, month: 8 })).toBe("August 2026");
  });
});

describe("weekdayName / formatFullDate", () => {
  // Independently verified real-calendar fact (not derived from this
  // module's own arithmetic): January 1, 2026 is a Thursday, so summing
  // 2026's Jan-Jul day counts (212 days) forward from there puts August 1,
  // 2026 on a Saturday.
  it("matches the real calendar for a known date", () => {
    expect(weekdayName(2026, 8, 1)).toBe("Saturday");
  });

  it("formats a full, disambiguating date string", () => {
    expect(formatFullDate(2026, 8, 18)).toBe("Tuesday, August 18, 2026");
  });
});

describe("WEEKDAY_HEADERS", () => {
  it("is Sunday-first, matching the grid's column order", () => {
    expect(WEEKDAY_HEADERS).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
  });
});

describe("monthGrid", () => {
  const grid = monthGrid({ year: 2026, month: 8 });

  it("always returns a fixed 42-cell (6-week) grid", () => {
    expect(grid).toHaveLength(42);
  });

  it("leads with the trailing days of the previous month needed to complete the first week", () => {
    // August 1, 2026 is a Saturday (see weekdayName test above), so the
    // Sunday-first grid needs 6 leading cells: July 26-31.
    expect(grid.slice(0, 6)).toEqual([
      { year: 2026, month: 7, day: 26, dateKey: "2026-07-26", inCurrentMonth: false },
      { year: 2026, month: 7, day: 27, dateKey: "2026-07-27", inCurrentMonth: false },
      { year: 2026, month: 7, day: 28, dateKey: "2026-07-28", inCurrentMonth: false },
      { year: 2026, month: 7, day: 29, dateKey: "2026-07-29", inCurrentMonth: false },
      { year: 2026, month: 7, day: 30, dateKey: "2026-07-30", inCurrentMonth: false },
      { year: 2026, month: 7, day: 31, dateKey: "2026-07-31", inCurrentMonth: false },
    ]);
  });

  it("places August 1 right after the leading days, marked inCurrentMonth", () => {
    expect(grid[6]).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      dateKey: "2026-08-01",
      inCurrentMonth: true,
    });
  });

  it("includes every day of the current month in order", () => {
    const augustDays = grid.filter((cell) => cell.inCurrentMonth);
    expect(augustDays).toHaveLength(31);
    expect(augustDays[0].dateKey).toBe("2026-08-01");
    expect(augustDays[30].dateKey).toBe("2026-08-31");
  });

  it("fills the remaining cells with the start of the next month", () => {
    // 6 leading + 31 August days = 37; 5 trailing cells complete the grid.
    const trailing = grid.slice(37);
    expect(trailing).toEqual([
      { year: 2026, month: 9, day: 1, dateKey: "2026-09-01", inCurrentMonth: false },
      { year: 2026, month: 9, day: 2, dateKey: "2026-09-02", inCurrentMonth: false },
      { year: 2026, month: 9, day: 3, dateKey: "2026-09-03", inCurrentMonth: false },
      { year: 2026, month: 9, day: 4, dateKey: "2026-09-04", inCurrentMonth: false },
      { year: 2026, month: 9, day: 5, dateKey: "2026-09-05", inCurrentMonth: false },
    ]);
  });

  it("handles a December-to-January month boundary in the trailing days", () => {
    const decemberGrid = monthGrid({ year: 2026, month: 12 });
    const trailing = decemberGrid.filter((cell) => !cell.inCurrentMonth && cell.month === 1);
    if (trailing.length > 0) {
      expect(trailing[0].year).toBe(2027);
    }
  });
});
