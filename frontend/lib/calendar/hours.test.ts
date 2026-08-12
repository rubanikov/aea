import { describe, expect, it } from "vitest";
import type { AvailabilityDay } from "@/lib/availability/types";
import { MIN_VISIBLE_HOURS, visibleHourRange } from "./hours";

const TIMEZONE = "America/New_York";

function window(
  day_of_week: number,
  start_time: string,
  end_time: string
): AvailabilityDay {
  return { id: day_of_week + 1, day_of_week, start_time, end_time };
}

function booking(startIso: string, endIso: string) {
  return { start_time: startIso, end_time: endIso };
}

describe("visibleHourRange", () => {
  it("spans the configured availability, floored/ceiled to whole hours, across all days", () => {
    const range = visibleHourRange(
      [
        window(0, "09:00:00", "17:00:00"),
        window(1, "08:30:00", "12:00:00"), // 8:30 start floors to 8
        window(4, "10:00:00", "18:15:00"), // 18:15 end ceils to 19
      ],
      [],
      TIMEZONE
    );

    expect(range).toEqual({ startHour: 8, endHour: 19 });
  });

  it("extends (never clips) the range to include a booking outside configured hours", () => {
    // 9–17 configured; a 7:00–7:30am ET booking and a 8:00–9:00pm ET one.
    const range = visibleHourRange(
      [window(0, "09:00:00", "17:00:00")],
      [
        booking("2026-08-18T11:00:00.000Z", "2026-08-18T11:30:00.000Z"), // 7:00–7:30am ET
        booking("2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z"), // 8–9pm ET Aug 18
      ],
      TIMEZONE
    );

    expect(range).toEqual({ startHour: 7, endHour: 21 });
  });

  it("computes booking hours in the provider's timezone, not UTC", () => {
    // 13:00Z is 9:00am ET; with no availability the range comes from the
    // booking alone (then widens to the 4-hour floor by extending the end).
    const range = visibleHourRange(
      [],
      [booking("2026-08-18T13:00:00.000Z", "2026-08-18T13:45:00.000Z")],
      TIMEZONE
    );

    expect(range).toEqual({ startHour: 9, endHour: 13 });
  });

  it(`widens a narrow range to ${MIN_VISIBLE_HOURS} hours by extending the end first`, () => {
    const range = visibleHourRange([window(2, "10:00:00", "11:00:00")], [], TIMEZONE);

    expect(range).toEqual({ startHour: 10, endHour: 14 });
  });

  it("extends the start once the end hits midnight", () => {
    const range = visibleHourRange([window(2, "22:00:00", "23:00:00")], [], TIMEZONE);

    // End can only stretch to 24, so the remaining hours come off the start.
    expect(range).toEqual({ startHour: 20, endHour: 24 });
  });

  it("treats a booking that crosses midnight as running to the bottom of the grid", () => {
    // 11:30pm–12:30am ET: end's wall-clock hour (0) must not shrink the range.
    const range = visibleHourRange(
      [window(0, "09:00:00", "17:00:00")],
      [booking("2026-08-19T03:30:00.000Z", "2026-08-19T04:30:00.000Z")],
      TIMEZONE
    );

    expect(range).toEqual({ startHour: 9, endHour: 24 });
  });

  it("returns null when there is no availability and no bookings", () => {
    expect(visibleHourRange([], [], TIMEZONE)).toBeNull();
  });
});
