import { describe, expect, it } from "vitest";
import { hasBookingStartPassed } from "./status";

describe("hasBookingStartPassed", () => {
  const now = new Date("2026-08-18T13:00:00.000Z");

  it("is false for a start time still in the future", () => {
    expect(hasBookingStartPassed("2026-08-18T14:00:00.000Z", now)).toBe(false);
  });

  it("is true for a start time already in the past", () => {
    expect(hasBookingStartPassed("2026-08-18T12:00:00.000Z", now)).toBe(true);
  });

  it("is true at the exact start time (start time has 'passed' the instant it arrives)", () => {
    expect(hasBookingStartPassed("2026-08-18T13:00:00.000Z", now)).toBe(true);
  });
});
