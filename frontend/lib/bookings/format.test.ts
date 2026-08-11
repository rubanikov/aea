import { describe, expect, it } from "vitest";
import { formatBookingTimeRange } from "./format";

describe("formatBookingTimeRange", () => {
  it("drops the repeated am/pm suffix when both ends share a period", () => {
    // 13:00Z-13:45Z is 9:00am-9:45am in America/New_York (EDT, UTC-4).
    expect(
      formatBookingTimeRange(
        "2026-08-18T13:00:00.000Z",
        "2026-08-18T13:45:00.000Z",
        "America/New_York"
      )
    ).toBe("9:00–9:45am");
  });

  it("keeps both suffixes for a range that crosses noon", () => {
    // 15:45Z-16:15Z is 11:45am-12:15pm in America/New_York.
    expect(
      formatBookingTimeRange(
        "2026-08-18T15:45:00.000Z",
        "2026-08-18T16:15:00.000Z",
        "America/New_York"
      )
    ).toBe("11:45am–12:15pm");
  });
});
