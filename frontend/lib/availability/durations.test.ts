import { describe, expect, it } from "vitest";
import { durationOptions, formatDuration, formatDurationShort } from "./durations";

describe("formatDuration", () => {
  it("labels a duration in minutes, never a bare number", () => {
    expect(formatDuration(45)).toBe("45 minutes");
  });

  it("uses the singular 'minute' for 1", () => {
    expect(formatDuration(1)).toBe("1 minute");
  });
});

describe("formatDurationShort", () => {
  it("labels a duration in the compact 'N min' form", () => {
    expect(formatDurationShort(15)).toBe("15 min");
  });
});

describe("durationOptions", () => {
  it("returns the preset list unchanged when the current value is a preset", () => {
    expect(durationOptions(15)).toEqual(durationOptions(undefined));
  });

  it("includes the current value, in order, even if it isn't a preset", () => {
    const options = durationOptions(12);
    expect(options).toContain(12);
    expect([...options].sort((a, b) => a - b)).toEqual([...options]);
  });

  it("does not duplicate a current value that is already a preset", () => {
    const options = durationOptions(15);
    expect(options.filter((minutes) => minutes === 15)).toHaveLength(1);
  });
});
