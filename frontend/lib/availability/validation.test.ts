import { describe, expect, it } from "vitest";
import {
  validateAppointmentType,
  validateBlockedTimeForm,
  validateWorkingHours,
} from "./validation";

describe("validateAppointmentType", () => {
  it("requires a name", () => {
    expect(validateAppointmentType({ name: "" })).toEqual({
      name: "Name is required",
    });
  });

  it("rejects a whitespace-only name", () => {
    expect(validateAppointmentType({ name: "   " })).toEqual({
      name: "Name is required",
    });
  });

  it("passes for a real name", () => {
    expect(validateAppointmentType({ name: "Follow-up" })).toEqual({});
  });
});

describe("validateWorkingHours", () => {
  let keyCounter = 0;
  function block(startTime: string, endTime: string) {
    keyCounter += 1;
    return { key: `k${keyCounter}`, startTime, endTime };
  }
  function day(
    dayName: "monday" | "tuesday" | "wednesday" | "saturday",
    blocks: ReturnType<typeof block>[],
    enabled = true
  ) {
    return { day: dayName, enabled, blocks };
  }

  it("flags an enabled day where a block's end time is before its start time", () => {
    expect(validateWorkingHours([day("monday", [block("17:00", "09:00")])])).toEqual({
      monday: "End time must be after start time.",
    });
  });

  it("flags a single block whose start and end are equal", () => {
    expect(validateWorkingHours([day("monday", [block("12:00", "12:00")])])).toEqual({
      monday: "End time must be after start time.",
    });
  });

  it("flags overlapping blocks on the same day", () => {
    expect(
      validateWorkingHours([
        day("monday", [block("09:00", "13:00"), block("12:00", "17:00")]),
      ])
    ).toEqual({
      monday: "These blocks overlap. Blocks on the same day can't share any time.",
    });
  });

  it("flags blocks less than one hour apart, interpolating the real gap and times", () => {
    expect(
      validateWorkingHours([
        day("tuesday", [block("09:00", "12:00"), block("12:30", "17:00")]),
      ])
    ).toEqual({
      tuesday:
        "Blocks must be at least 1 hour apart. There are only 30 minutes between 12:00 and 12:30.",
    });
  });

  it("flags touching blocks (12:00 end then 12:00 start) as a 0-minute gap", () => {
    expect(
      validateWorkingHours([
        day("monday", [block("09:00", "12:00"), block("12:00", "15:00")]),
      ])
    ).toEqual({
      monday:
        "Blocks must be at least 1 hour apart. There are only 0 minutes between 12:00 and 12:00.",
    });
  });

  it("passes blocks exactly one hour apart (12:00 end then 13:00 start)", () => {
    expect(
      validateWorkingHours([
        day("monday", [block("09:00", "12:00"), block("13:00", "17:00")]),
      ])
    ).toEqual({});
  });

  it("validates blocks by time order, not input order", () => {
    expect(
      validateWorkingHours([
        day("monday", [block("14:00", "17:00"), block("09:00", "13:30")]),
      ])
    ).toEqual({
      monday:
        "Blocks must be at least 1 hour apart. There are only 30 minutes between 13:30 and 14:00.",
    });
  });

  it("ignores disabled days regardless of their blocks", () => {
    expect(
      validateWorkingHours([day("saturday", [block("17:00", "09:00")], false)])
    ).toEqual({});
  });

  it("passes for a valid enabled day with one block", () => {
    expect(validateWorkingHours([day("monday", [block("09:00", "17:00")])])).toEqual({});
  });

  it("reports an error per invalid day, not just the first one found", () => {
    expect(
      validateWorkingHours([
        day("monday", [block("17:00", "09:00")]),
        day("tuesday", [block("09:00", "12:00"), block("11:00", "17:00")]),
        day("wednesday", [block("09:00", "17:00")]),
      ])
    ).toEqual({
      monday: "End time must be after start time.",
      tuesday: "These blocks overlap. Blocks on the same day can't share any time.",
    });
  });
});

describe("validateBlockedTimeForm", () => {
  const VALID = {
    label: "Vacation",
    fromDate: "2026-08-24",
    fromTime: "00:00",
    toDate: "2026-08-29",
    toTime: "23:59",
  };

  it("passes for a valid range", () => {
    expect(validateBlockedTimeForm(VALID)).toEqual({});
  });

  it("requires each date/time field", () => {
    expect(
      validateBlockedTimeForm({
        label: "",
        fromDate: "",
        fromTime: "",
        toDate: "",
        toTime: "",
      })
    ).toEqual({
      fromDate: "From date is required",
      fromTime: "From time is required",
      toDate: "To date is required",
      toTime: "To time is required",
    });
  });

  it("rejects a 'to' that is before 'from', as a range error rather than a per-field one", () => {
    expect(
      validateBlockedTimeForm({
        ...VALID,
        toDate: "2026-08-20",
        toTime: "00:00",
      })
    ).toEqual({ range: "End must be after start" });
  });

  it("rejects a 'to' equal to 'from'", () => {
    expect(
      validateBlockedTimeForm({
        ...VALID,
        toDate: VALID.fromDate,
        toTime: VALID.fromTime,
      })
    ).toEqual({ range: "End must be after start" });
  });

  it("does not check range order until every field is present", () => {
    expect(
      validateBlockedTimeForm({ ...VALID, fromDate: "" })
    ).toEqual({ fromDate: "From date is required" });
  });
});
