import { describe, expect, it } from "vitest";
import {
  formatAppointmentDateTime,
  formatBookingTimeRange,
  formatCancellationNoticeMessage,
} from "./format";

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

describe("formatAppointmentDateTime", () => {
  it("combines the full weekday date with the time range", () => {
    // 15:00Z-15:30Z on Aug 18 is 10:00-10:30am in America/Chicago (CDT, UTC-5).
    expect(
      formatAppointmentDateTime(
        "2026-08-18T15:00:00.000Z",
        "2026-08-18T15:30:00.000Z",
        "America/Chicago"
      )
    ).toBe("Tuesday, August 18, 2026, 10:00–10:30am");
  });
});

describe("formatCancellationNoticeMessage", () => {
  it("rounds fractional hours up and includes the 24h figure", () => {
    expect(formatCancellationNoticeMessage(13.4)).toBe(
      "Starts in 14h — inside the 24h change window. Call the office to change this visit."
    );
  });

  it("matches the wireframe's exact sample framing at 14h", () => {
    expect(formatCancellationNoticeMessage(14)).toBe(
      "Starts in 14h — inside the 24h change window. Call the office to change this visit."
    );
  });

  it("clamps a negative (already-started) value to 0h rather than going negative", () => {
    expect(formatCancellationNoticeMessage(-2)).toBe(
      "Starts in 0h — inside the 24h change window. Call the office to change this visit."
    );
  });
});
