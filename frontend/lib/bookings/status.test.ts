import { describe, expect, it } from "vitest";
import {
  CANCELLATION_NOTICE_HOURS,
  classifyAppointmentTab,
  hasBookingStartPassed,
  hoursUntilBookingStart,
  isWithinCancellationNoticeWindow,
} from "./status";

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

describe("hoursUntilBookingStart", () => {
  it("returns the positive fractional hours remaining before a future start time", () => {
    const now = new Date("2026-08-11T19:00:00.000Z");
    // Wed, Aug 12 2026 9:00am UTC, 14 hours after 7pm the day before.
    expect(hoursUntilBookingStart("2026-08-12T09:00:00.000Z", now)).toBe(14);
  });

  it("returns a negative value once the start time has passed", () => {
    const now = new Date("2026-08-18T15:00:00.000Z");
    expect(hoursUntilBookingStart("2026-08-18T13:00:00.000Z", now)).toBe(-2);
  });
});

describe("isWithinCancellationNoticeWindow", () => {
  it("is true just inside the 24h boundary", () => {
    const now = new Date("2026-08-12T09:00:00.000Z");
    expect(
      isWithinCancellationNoticeWindow(
        "2026-08-13T08:59:00.000Z", // 23h59m away
        now
      )
    ).toBe(true);
  });

  it("is false just outside the 24h boundary", () => {
    const now = new Date("2026-08-12T09:00:00.000Z");
    expect(
      isWithinCancellationNoticeWindow(
        "2026-08-13T09:01:00.000Z", // 24h01m away
        now
      )
    ).toBe(false);
  });

  it(`is false exactly at the ${CANCELLATION_NOTICE_HOURS}h boundary (only strictly less counts as inside)`, () => {
    const now = new Date("2026-08-12T09:00:00.000Z");
    expect(isWithinCancellationNoticeWindow("2026-08-13T09:00:00.000Z", now)).toBe(false);
  });

  it("is true once the appointment has already started", () => {
    const now = new Date("2026-08-18T15:00:00.000Z");
    expect(isWithinCancellationNoticeWindow("2026-08-18T13:00:00.000Z", now)).toBe(true);
  });
});

describe("classifyAppointmentTab", () => {
  const now = new Date("2026-08-18T13:00:00.000Z");

  it("classifies a confirmed booking with a future start time as upcoming", () => {
    expect(
      classifyAppointmentTab({ status: "confirmed", start_time: "2026-08-19T13:00:00.000Z" }, now)
    ).toBe("upcoming");
  });

  it("classifies a confirmed booking whose start time has passed as past", () => {
    expect(
      classifyAppointmentTab({ status: "confirmed", start_time: "2026-08-17T13:00:00.000Z" }, now)
    ).toBe("past");
  });

  it("classifies completed/no_show bookings as past", () => {
    expect(
      classifyAppointmentTab({ status: "completed", start_time: "2026-08-17T13:00:00.000Z" }, now)
    ).toBe("past");
    expect(
      classifyAppointmentTab({ status: "no_show", start_time: "2026-08-17T13:00:00.000Z" }, now)
    ).toBe("past");
  });

  it("classifies a cancelled booking as cancelled even if its start time is still in the future", () => {
    expect(
      classifyAppointmentTab({ status: "cancelled", start_time: "2026-08-19T13:00:00.000Z" }, now)
    ).toBe("cancelled");
  });
});
