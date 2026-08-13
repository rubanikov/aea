import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationShort } from "./durations";

describe("formatDuration", () => {
  it("labels a duration in minutes, never a bare number", () => {
    expect(formatDuration(60)).toBe("60 minutes");
  });

  it("uses the singular 'minute' for 1", () => {
    expect(formatDuration(1)).toBe("1 minute");
  });
});

describe("formatDurationShort", () => {
  it("labels a duration in the compact 'N min' form", () => {
    expect(formatDurationShort(60)).toBe("60 min");
  });
});
