import { describe, expect, it } from "vitest";
import { layoutBlockedRegion, layoutDayBlocks } from "./layout";

const TIMEZONE = "America/New_York";
const NINE_TO_FIVE = { startHour: 9, endHour: 17 };

describe("layoutDayBlocks", () => {
  it("positions a block by its wall-clock start/duration as percentages of the visible range", () => {
    // 13:00Z = 9:00am ET, 45 minutes long; range 9–17 = 480 minutes.
    const geometry = layoutDayBlocks(
      [{ id: 1, start_time: "2026-08-18T13:00:00.000Z", end_time: "2026-08-18T13:45:00.000Z" }],
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(geometry.get(1)).toEqual({
      topPercent: 0,
      heightPercent: (45 / 480) * 100,
      leftPercent: 0,
      widthPercent: 100,
    });
  });

  it("converts start and end independently, so a block spanning spring-forward is its wall-clock height (DST-safe)", () => {
    // 2026-03-08, America/New_York springs forward at 2:00am.
    // 06:30Z = 1:30am EST; 07:30Z = 3:30am EDT. One UTC hour, but the
    // wall clock says 1:30 -> 3:30: the block must be TWO hours tall.
    const range = { startHour: 1, endHour: 5 }; // 240 minutes
    const geometry = layoutDayBlocks(
      [{ id: 7, start_time: "2026-03-08T06:30:00.000Z", end_time: "2026-03-08T07:30:00.000Z" }],
      "2026-03-08",
      TIMEZONE,
      range
    );

    expect(geometry.get(7)).toEqual({
      topPercent: (30 / 240) * 100, // starts 1:30, range starts 1:00
      heightPercent: (120 / 240) * 100, // two wall-clock hours
      leftPercent: 0,
      widthPercent: 100,
    });
  });

  it("lays overlapping bookings out side-by-side instead of stacking them", () => {
    // 9:00–10:00 and 9:30–10:30 ET overlap; each gets half the column.
    const geometry = layoutDayBlocks(
      [
        { id: 1, start_time: "2026-08-18T13:00:00.000Z", end_time: "2026-08-18T14:00:00.000Z" },
        { id: 2, start_time: "2026-08-18T13:30:00.000Z", end_time: "2026-08-18T14:30:00.000Z" },
      ],
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(geometry.get(1)).toMatchObject({ leftPercent: 0, widthPercent: 50 });
    expect(geometry.get(2)).toMatchObject({ leftPercent: 50, widthPercent: 50 });
  });

  it("gives non-overlapping bookings the full column width, even after an earlier overlap cluster", () => {
    const geometry = layoutDayBlocks(
      [
        { id: 1, start_time: "2026-08-18T13:00:00.000Z", end_time: "2026-08-18T14:00:00.000Z" },
        { id: 2, start_time: "2026-08-18T13:30:00.000Z", end_time: "2026-08-18T14:30:00.000Z" },
        { id: 3, start_time: "2026-08-18T19:00:00.000Z", end_time: "2026-08-18T19:30:00.000Z" },
      ],
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(geometry.get(3)).toMatchObject({ leftPercent: 0, widthPercent: 100 });
  });

  it("reuses a freed lane: a booking starting after an earlier lane ends slots back into it", () => {
    // A(9-11), B(9:30-10), C(10-10:30): C overlaps A but not B, so C takes
    // B's freed lane and the cluster stays two lanes wide.
    const geometry = layoutDayBlocks(
      [
        { id: 1, start_time: "2026-08-18T13:00:00.000Z", end_time: "2026-08-18T15:00:00.000Z" },
        { id: 2, start_time: "2026-08-18T13:30:00.000Z", end_time: "2026-08-18T14:00:00.000Z" },
        { id: 3, start_time: "2026-08-18T14:00:00.000Z", end_time: "2026-08-18T14:30:00.000Z" },
      ],
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(geometry.get(1)).toMatchObject({ leftPercent: 0, widthPercent: 50 });
    expect(geometry.get(2)).toMatchObject({ leftPercent: 50, widthPercent: 50 });
    expect(geometry.get(3)).toMatchObject({ leftPercent: 50, widthPercent: 50 });
  });

  it("clamps a booking that crosses midnight to the bottom of the day column", () => {
    // 11:00pm ET -> 1:00am ET next day, range 20–24.
    const geometry = layoutDayBlocks(
      [{ id: 5, start_time: "2026-08-19T03:00:00.000Z", end_time: "2026-08-19T05:00:00.000Z" }],
      "2026-08-18",
      TIMEZONE,
      { startHour: 20, endHour: 24 }
    );

    expect(geometry.get(5)).toEqual({
      topPercent: 75, // 11pm within 20–24
      heightPercent: 25, // runs to the bottom, not into the next day
      leftPercent: 0,
      widthPercent: 100,
    });
  });
});

describe("layoutBlockedRegion", () => {
  it("positions a same-day block by its wall-clock start/end within the visible range", () => {
    // 14:00Z–16:00Z = 10:00am–12:00pm ET; range 9–17 = 480 minutes.
    const region = layoutBlockedRegion(
      { start: "2026-08-18T14:00:00.000Z", end: "2026-08-18T16:00:00.000Z" },
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(region).toEqual({
      topPercent: (60 / 480) * 100,
      heightPercent: (120 / 480) * 100,
      clippedStartMin: 10 * 60,
      clippedEndMin: 12 * 60,
    });
  });

  it("returns null for a day the block doesn't touch", () => {
    const block = {
      start: "2026-08-18T14:00:00.000Z",
      end: "2026-08-18T16:00:00.000Z",
    };
    expect(layoutBlockedRegion(block, "2026-08-17", TIMEZONE, NINE_TO_FIVE)).toBeNull();
    expect(layoutBlockedRegion(block, "2026-08-19", TIMEZONE, NINE_TO_FIVE)).toBeNull();
  });

  it("paints a full-column region on each interior day of a multi-day block", () => {
    // Wed Aug 19 00:00 ET -> Sat Aug 22 00:00 ET (04:00Z in August's EDT).
    const vacation = {
      start: "2026-08-19T04:00:00.000Z",
      end: "2026-08-22T04:00:00.000Z",
    };

    for (const day of ["2026-08-19", "2026-08-20", "2026-08-21"]) {
      expect(layoutBlockedRegion(vacation, day, TIMEZONE, NINE_TO_FIVE)).toEqual({
        topPercent: 0,
        heightPercent: 100,
        clippedStartMin: 9 * 60,
        clippedEndMin: 17 * 60,
      });
    }
    // Ends exactly at Saturday's midnight: nothing to paint on Saturday.
    expect(layoutBlockedRegion(vacation, "2026-08-22", TIMEZONE, NINE_TO_FIVE)).toBeNull();
  });

  it("truncates a block extending past the top of the visible hours at the grid edge", () => {
    // 7:00am–10:00am ET against a 9–17 grid: only 9:00–10:00 is visible.
    const region = layoutBlockedRegion(
      { start: "2026-08-18T11:00:00.000Z", end: "2026-08-18T14:00:00.000Z" },
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(region).toEqual({
      topPercent: 0,
      heightPercent: (60 / 480) * 100,
      clippedStartMin: 9 * 60,
      clippedEndMin: 10 * 60,
    });
  });

  it("truncates a block extending past the bottom of the visible hours at the grid edge", () => {
    // 4:00pm–8:00pm ET against a 9–17 grid: only 4:00–5:00pm is visible.
    const region = layoutBlockedRegion(
      { start: "2026-08-18T20:00:00.000Z", end: "2026-08-19T00:00:00.000Z" },
      "2026-08-18",
      TIMEZONE,
      NINE_TO_FIVE
    );

    expect(region).toEqual({
      topPercent: (420 / 480) * 100,
      heightPercent: (60 / 480) * 100,
      clippedStartMin: 16 * 60,
      clippedEndMin: 17 * 60,
    });
  });

  it("returns null for a block entirely outside the visible hours", () => {
    // 6:00–8:00am ET against a 9–17 grid.
    expect(
      layoutBlockedRegion(
        { start: "2026-08-18T10:00:00.000Z", end: "2026-08-18T12:00:00.000Z" },
        "2026-08-18",
        TIMEZONE,
        NINE_TO_FIVE
      )
    ).toBeNull();
  });

  it("converts start and end independently, so a block spanning spring-forward is its wall-clock height (DST-safe)", () => {
    // 2026-03-08, America/New_York springs forward at 2:00am.
    // 06:30Z = 1:30am EST; 07:30Z = 3:30am EDT. One UTC hour, but the
    // wall clock says 1:30 -> 3:30: the region must be TWO hours tall.
    const range = { startHour: 1, endHour: 5 }; // 240 minutes
    const region = layoutBlockedRegion(
      { start: "2026-03-08T06:30:00.000Z", end: "2026-03-08T07:30:00.000Z" },
      "2026-03-08",
      TIMEZONE,
      range
    );

    expect(region).toEqual({
      topPercent: (30 / 240) * 100, // starts 1:30, range starts 1:00
      heightPercent: (120 / 240) * 100, // two wall-clock hours
      clippedStartMin: 90,
      clippedEndMin: 210,
    });
  });
});
