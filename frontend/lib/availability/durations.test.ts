import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOT_DURATION,
  SLOT_DURATION_OPTIONS,
  formatDuration,
  formatDurationShort,
} from "./durations";

describe("SLOT_DURATION_OPTIONS", () => {
  it("offers exactly the two server-accepted slot lengths, shortest first", () => {
    expect(SLOT_DURATION_OPTIONS).toEqual([30, 60]);
  });

  it("defaults to 60, matching the backend model default", () => {
    expect(DEFAULT_SLOT_DURATION).toBe(60);
  });
});

describe("formatDuration", () => {
  it("labels a duration in minutes, never a bare number", () => {
    expect(formatDuration(60)).toBe("60 minutes");
    expect(formatDuration(30)).toBe("30 minutes");
  });

  it("uses the singular 'minute' for 1", () => {
    expect(formatDuration(1)).toBe("1 minute");
  });
});

describe("formatDurationShort", () => {
  it("labels a duration in the compact 'N min' form", () => {
    expect(formatDurationShort(60)).toBe("60 min");
    expect(formatDurationShort(30)).toBe("30 min");
  });
});
