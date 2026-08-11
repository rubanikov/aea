import { describe, expect, it } from "vitest";
import { dayOfWeekFromIndex, dayOfWeekToIndex, WEEKDAYS } from "./days";

describe("dayOfWeekToIndex / dayOfWeekFromIndex", () => {
  it("maps monday to 0 and sunday to 6, matching Python's date.weekday()", () => {
    expect(dayOfWeekToIndex("monday")).toBe(0);
    expect(dayOfWeekToIndex("sunday")).toBe(6);
  });

  it("round-trips every weekday through both directions", () => {
    for (const { value } of WEEKDAYS) {
      expect(dayOfWeekFromIndex(dayOfWeekToIndex(value))).toBe(value);
    }
  });

  it("returns undefined for an out-of-range index", () => {
    expect(dayOfWeekFromIndex(7)).toBeUndefined();
  });
});
