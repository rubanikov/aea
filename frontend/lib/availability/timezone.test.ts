import { describe, expect, it } from "vitest";
import {
  formatZonedDateTime,
  zonedDateKey,
  zonedDateTimeToUtcIso,
  zonedTimeLabel,
} from "./timezone";

describe("zonedDateTimeToUtcIso", () => {
  it("converts a wall-clock time in an America/New_York summer (EDT, UTC-4) date to UTC", () => {
    expect(zonedDateTimeToUtcIso("2026-08-24", "00:00", "America/New_York")).toBe(
      "2026-08-24T04:00:00.000Z"
    );
  });

  it("converts a wall-clock time in an America/New_York winter (EST, UTC-5) date to UTC", () => {
    expect(zonedDateTimeToUtcIso("2026-01-15", "09:00", "America/New_York")).toBe(
      "2026-01-15T14:00:00.000Z"
    );
  });

  it("passes a UTC wall-clock time straight through", () => {
    expect(zonedDateTimeToUtcIso("2026-08-24", "12:30", "UTC")).toBe(
      "2026-08-24T12:30:00.000Z"
    );
  });

  it("handles a half-hour-offset zone (Asia/Kolkata, UTC+5:30)", () => {
    expect(zonedDateTimeToUtcIso("2026-08-24", "05:30", "Asia/Kolkata")).toBe(
      "2026-08-24T00:00:00.000Z"
    );
  });
});

describe("formatZonedDateTime", () => {
  it("renders a UTC instant as the wireframe's wall-clock format in the given zone", () => {
    expect(
      formatZonedDateTime("2026-08-24T04:00:00.000Z", "America/New_York")
    ).toBe("Aug 24, 2026 00:00");
  });

  it("round-trips with zonedDateTimeToUtcIso", () => {
    const iso = zonedDateTimeToUtcIso("2026-09-03", "13:00", "America/New_York");
    expect(formatZonedDateTime(iso, "America/New_York")).toBe("Sep 3, 2026 13:00");
  });

  it("falls back to the raw input for a value that doesn't parse as a date", () => {
    expect(formatZonedDateTime("not-a-date", "UTC")).toBe("not-a-date");
  });
});

describe("zonedDateKey", () => {
  it("keys a UTC instant by its wall-clock date in the given zone", () => {
    // Same fixture as formatZonedDateTime's first test: midnight EDT on
    // Aug 24 is 04:00 UTC.
    expect(zonedDateKey("2026-08-24T04:00:00.000Z", "America/New_York")).toBe(
      "2026-08-24"
    );
  });

  it("keys to the previous day when the zone's offset rolls the instant back a date", () => {
    // 02:00 UTC minus the EDT (UTC-4) offset is 22:00 the previous day.
    expect(zonedDateKey("2026-08-24T02:00:00.000Z", "America/New_York")).toBe(
      "2026-08-23"
    );
  });

  it("passes a UTC date straight through in the UTC zone", () => {
    expect(zonedDateKey("2026-08-24T12:30:00.000Z", "UTC")).toBe("2026-08-24");
  });
});

describe("zonedTimeLabel", () => {
  it("renders a morning time with a lowercase am suffix and no leading zero", () => {
    // 13:00 UTC minus the EDT (UTC-4) offset is 09:00 local.
    expect(zonedTimeLabel("2026-08-24T13:00:00.000Z", "America/New_York")).toBe(
      "9:00am"
    );
  });

  it("renders an afternoon time with a lowercase pm suffix", () => {
    // 18:30 UTC minus 4 hours is 14:30 local.
    expect(zonedTimeLabel("2026-08-24T18:30:00.000Z", "America/New_York")).toBe(
      "2:30pm"
    );
  });

  it("renders noon as 12:00pm and midnight as 12:00am", () => {
    expect(zonedTimeLabel("2026-08-24T16:00:00.000Z", "America/New_York")).toBe(
      "12:00pm"
    );
    expect(zonedTimeLabel("2026-08-24T04:00:00.000Z", "America/New_York")).toBe(
      "12:00am"
    );
  });
});
