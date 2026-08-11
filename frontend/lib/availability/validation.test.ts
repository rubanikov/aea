import { describe, expect, it } from "vitest";
import { validateAppointmentType, validateWorkingHours } from "./validation";

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
