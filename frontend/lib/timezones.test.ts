import { describe, expect, it } from "vitest";
import { TIMEZONES, formatTimezone, timezoneOptions } from "./timezones";

describe("formatTimezone", () => {
  it("names the North American zones users ask for by name, not just by city", () => {
    expect(formatTimezone("America/New_York")).toBe("Eastern Time (New York)");
    expect(formatTimezone("America/Chicago")).toBe("Central Time (Chicago)");
    expect(formatTimezone("America/Denver")).toBe("Mountain Time (Denver)");
    expect(formatTimezone("America/Los_Angeles")).toBe("Pacific Time (Los Angeles)");
    expect(formatTimezone("America/Halifax")).toBe("Atlantic Time (Halifax)");
    expect(formatTimezone("America/Anchorage")).toBe("Alaska Time (Anchorage)");
    expect(formatTimezone("Pacific/Honolulu")).toBe("Hawaii Time (Honolulu)");
  });

  it("names zones outside North America that have a common name too", () => {
    expect(formatTimezone("Europe/Paris")).toBe("Central European Time (Paris)");
    expect(formatTimezone("Asia/Kolkata")).toBe("India Standard Time (Kolkata)");
    expect(formatTimezone("UTC")).toBe("Coordinated Universal Time (UTC)");
  });

  it("falls back to the bare city for a zone with no common name", () => {
    expect(formatTimezone("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("never leaves an offered zone showing a raw identifier", () => {
    for (const zone of TIMEZONES) {
      const label = formatTimezone(zone);
      expect(label, `${zone} is unlabeled`).toMatch(/^.+ \(.+\)$/);
      expect(label, `${zone} leaks its identifier`).not.toMatch(/[/_]/);
    }
  });

  it("keeps the IANA identifier as the value the picker stores", () => {
    // The label is display-only: the option list itself is untouched.
    expect(timezoneOptions("America/New_York")).toContain("America/New_York");
  });
});

describe("timezoneOptions", () => {
  it("offers Atlantic time, which the US/Canada set is otherwise missing", () => {
    expect(TIMEZONES).toContain("America/Halifax");
  });

  it("returns the curated list unchanged when the current value is already on it", () => {
    expect(timezoneOptions("America/Chicago")).toEqual(TIMEZONES);
  });

  it("prepends an unrecognized current value so it is never silently dropped", () => {
    expect(timezoneOptions("America/Argentina/Buenos_Aires")[0]).toBe(
      "America/Argentina/Buenos_Aires"
    );
  });
});
