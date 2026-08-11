import { describe, expect, it } from "vitest";
import { extractBookingErrorDetail } from "./errors";

describe("extractBookingErrorDetail", () => {
  it("extracts a string 'detail' field", () => {
    expect(
      extractBookingErrorDetail({
        detail: "Can't mark no-show before the appointment start time.",
      })
    ).toBe("Can't mark no-show before the appointment start time.");
  });

  it("returns null for a body with no 'detail' field", () => {
    expect(extractBookingErrorDetail({ status: "invalid" })).toBeNull();
  });

  it("returns null for a non-string 'detail' field", () => {
    expect(extractBookingErrorDetail({ detail: 42 })).toBeNull();
  });

  it("returns null for a non-object body", () => {
    expect(extractBookingErrorDetail(null)).toBeNull();
    expect(extractBookingErrorDetail("plain string")).toBeNull();
  });
});
