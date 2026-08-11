import { describe, expect, it } from "vitest";
import { formatAuditTimestamp } from "./format";

describe("formatAuditTimestamp", () => {
  it("formats an ISO timestamp as an explicit UTC string", () => {
    expect(formatAuditTimestamp("2026-08-10T14:32:07.000Z")).toBe(
      "2026-08-10 14:32:07Z"
    );
  });

  it("converts a non-UTC offset to UTC rather than displaying it as-is", () => {
    // 09:32:07-05:00 is 14:32:07Z.
    expect(formatAuditTimestamp("2026-08-10T09:32:07-05:00")).toBe(
      "2026-08-10 14:32:07Z"
    );
  });

  it("falls back to the raw input for an unparseable timestamp", () => {
    expect(formatAuditTimestamp("not-a-date")).toBe("not-a-date");
  });
});
