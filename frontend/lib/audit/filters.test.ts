import { describe, expect, it } from "vitest";
import { buildAuditLogQuery, describeActiveFilters } from "./filters";
import { EMPTY_AUDIT_LOG_FILTERS, type AuditLogFilterValues } from "./types";

describe("buildAuditLogQuery", () => {
  it("always includes the page number, even with no filters set", () => {
    expect(buildAuditLogQuery(EMPTY_AUDIT_LOG_FILTERS, 1)).toBe("page=1");
  });

  it("includes only the filters that are set, snake_cased for the API", () => {
    const filters: AuditLogFilterValues = {
      actor: "u1",
      action: "",
      targetType: "appointment",
      dateFrom: "2026-01-01",
      dateTo: "",
    };
    const query = buildAuditLogQuery(filters, 3);
    const params = new URLSearchParams(query);

    expect(params.get("actor")).toBe("u1");
    expect(params.has("action")).toBe(false);
    expect(params.get("target_type")).toBe("appointment");
    expect(params.get("date_from")).toBe("2026-01-01");
    expect(params.has("date_to")).toBe(false);
    expect(params.get("page")).toBe("3");
  });

  it("trims whitespace-only text fields to nothing", () => {
    const query = buildAuditLogQuery(
      { ...EMPTY_AUDIT_LOG_FILTERS, actor: "   " },
      1
    );
    expect(new URLSearchParams(query).has("actor")).toBe(false);
  });
});

describe("describeActiveFilters", () => {
  it("says no filters are applied when every field is blank", () => {
    expect(describeActiveFilters(EMPTY_AUDIT_LOG_FILTERS)).toMatch(
      /no filters applied/i
    );
  });

  it("summarizes each active field", () => {
    const description = describeActiveFilters({
      actor: "u1",
      action: "status:confirmed->completed",
      targetType: "appointment",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    });

    expect(description).toContain('actor "u1"');
    expect(description).toContain('action "status:confirmed->completed"');
    expect(description).toContain('target type "appointment"');
    expect(description).toContain("from 2026-01-01");
    expect(description).toContain("to 2026-02-01");
  });
});
