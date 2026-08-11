import { describe, expect, it } from "vitest";
import { addWeeks, formatWeekRange, startOfWeek, weekDates } from "./week";

describe("startOfWeek", () => {
  it("returns the same date when it's already a Monday", () => {
    // Independently verified: August 17, 2026 is a Monday (August 18,
    // 2026 is a Tuesday per lib/scheduling/calendar.test.ts's own
    // known-date fixture).
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
  });

  it("rolls a mid-week date back to that week's Monday", () => {
    expect(startOfWeek("2026-08-19")).toBe("2026-08-17");
  });

  it("rolls a Sunday back to the same week's Monday, not the next one", () => {
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
  });

  it("handles a week that crosses a month boundary", () => {
    // August 31, 2026 is a Monday; September 3 is a Thursday in the same week.
    expect(startOfWeek("2026-09-03")).toBe("2026-08-31");
  });
});

describe("addWeeks", () => {
  it("advances a Monday forward by whole weeks", () => {
    expect(addWeeks("2026-08-17", 1)).toBe("2026-08-24");
    expect(addWeeks("2026-08-17", 2)).toBe("2026-08-31");
  });

  it("goes backward for a negative delta", () => {
    expect(addWeeks("2026-08-17", -1)).toBe("2026-08-10");
  });

  it("rolls over a year boundary", () => {
    // December 28, 2026 is a Monday.
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
  });
});

describe("weekDates", () => {
  it("returns all 7 dates, Monday through Sunday, for the given week", () => {
    expect(weekDates("2026-08-17")).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });
});

describe("formatWeekRange", () => {
  it("formats a week entirely within one month", () => {
    expect(formatWeekRange("2026-08-17")).toBe("Week of Aug 17–23, 2026");
  });

  it("formats a week crossing a month boundary within the same year", () => {
    expect(formatWeekRange("2026-08-31")).toBe("Week of Aug 31–Sep 6, 2026");
  });

  it("formats a week crossing a year boundary", () => {
    expect(formatWeekRange("2026-12-28")).toBe("Week of Dec 28, 2026–Jan 3, 2027");
  });
});
