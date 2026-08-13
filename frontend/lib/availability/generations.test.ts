import { describe, expect, it } from "vitest";
import { generationWindowsInRange, generationWindowsOnDate } from "./generations";
import type { ScheduleGeneration, ScheduleWindow } from "./types";

function window(day: number, start: string, end: string, id = day): ScheduleWindow {
  return { id, day_of_week: day, start_time: start, end_time: end };
}

const CURRENT: ScheduleGeneration = {
  effective_from: null,
  windows: [window(2, "08:00:00", "15:00:00")],
};

const PENDING: ScheduleGeneration = {
  effective_from: "2026-10-08",
  windows: [
    window(2, "08:00:00", "13:00:00", 10),
    window(2, "16:00:00", "18:00:00", 11),
  ],
};

describe("generationWindowsOnDate", () => {
  it("uses live hours before the pending effective date", () => {
    expect(generationWindowsOnDate(CURRENT, PENDING, "2026-10-07")).toEqual(CURRENT.windows);
  });

  it("uses pending hours on and after the effective date", () => {
    expect(generationWindowsOnDate(CURRENT, PENDING, "2026-10-08")).toEqual(PENDING.windows);
    expect(generationWindowsOnDate(CURRENT, PENDING, "2026-11-04")).toEqual(PENDING.windows);
  });

  it("stays on live hours when there is no pending generation", () => {
    expect(generationWindowsOnDate(CURRENT, null, "2026-11-04")).toEqual(CURRENT.windows);
  });
});

describe("generationWindowsInRange", () => {
  it("unions both generations when a week straddles the switch", () => {
    const windows = generationWindowsInRange(CURRENT, PENDING, [
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(windows).toEqual([...CURRENT.windows, ...PENDING.windows]);
  });
});
