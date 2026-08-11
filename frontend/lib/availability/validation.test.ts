import { describe, expect, it } from "vitest";
import {
  validateAppointmentType,
  validateBlockedTimeForm,
  validateWorkingHours,
} from "./validation";

describe("validateAppointmentType", () => {
  it("requires a name", () => {
    expect(
      validateAppointmentType({ name: "", duration_minutes: 15 })
    ).toEqual({ name: "Name is required" });
  });

  it("rejects a whitespace-only name", () => {
    expect(
      validateAppointmentType({ name: "   ", duration_minutes: 15 })
    ).toEqual({ name: "Name is required" });
  });

  it("passes for a real name", () => {
    expect(
      validateAppointmentType({ name: "Follow-up", duration_minutes: 15 })
    ).toEqual({});
  });
});

describe("validateWorkingHours", () => {
  it("flags an enabled day where the end time is before the start time", () => {
    const rows = [
      { day: "monday" as const, enabled: true, startTime: "17:00", endTime: "09:00" },
    ];
    expect(validateWorkingHours(rows)).toEqual({
      monday: "End time must be after start time",
    });
  });

  it("flags an enabled day where start and end are equal", () => {
    const rows = [
      { day: "monday" as const, enabled: true, startTime: "09:00", endTime: "09:00" },
    ];
    expect(validateWorkingHours(rows)).toEqual({
      monday: "End time must be after start time",
    });
  });

  it("ignores disabled days regardless of their times", () => {
    const rows = [
      { day: "saturday" as const, enabled: false, startTime: "17:00", endTime: "09:00" },
    ];
    expect(validateWorkingHours(rows)).toEqual({});
  });

  it("passes for a valid enabled day", () => {
    const rows = [
      { day: "monday" as const, enabled: true, startTime: "09:00", endTime: "17:00" },
    ];
    expect(validateWorkingHours(rows)).toEqual({});
  });

  it("reports an error per invalid row, not just the first one found", () => {
    const rows = [
      { day: "monday" as const, enabled: true, startTime: "17:00", endTime: "09:00" },
      { day: "tuesday" as const, enabled: true, startTime: "20:00", endTime: "10:00" },
      { day: "wednesday" as const, enabled: true, startTime: "09:00", endTime: "17:00" },
    ];
    expect(validateWorkingHours(rows)).toEqual({
      monday: "End time must be after start time",
      tuesday: "End time must be after start time",
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
