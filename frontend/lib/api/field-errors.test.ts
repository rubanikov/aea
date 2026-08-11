import { describe, expect, it } from "vitest";
import { isFieldErrorBody, splitFieldErrors } from "./field-errors";

describe("isFieldErrorBody", () => {
  it("accepts a flat string-valued object", () => {
    expect(isFieldErrorBody({ email: "already registered" })).toBe(true);
  });

  it("accepts DRF's default list-of-strings-valued object", () => {
    expect(
      isFieldErrorBody({ email: ["An account with this email already exists."] })
    ).toBe(true);
  });

  it("rejects null, arrays, and non-string values", () => {
    expect(isFieldErrorBody(null)).toBe(false);
    expect(isFieldErrorBody(["oops"])).toBe(false);
    expect(isFieldErrorBody({ email: 123 })).toBe(false);
    expect(isFieldErrorBody({ email: [123] })).toBe(false);
  });
});

describe("splitFieldErrors", () => {
  it("maps known fields onto fieldErrors", () => {
    const { fieldErrors, formError } = splitFieldErrors(
      { email: "already registered" },
      new Set(["email", "name"])
    );
    expect(fieldErrors).toEqual({ email: "already registered" });
    expect(formError).toBeNull();
  });

  it("normalizes DRF's list-of-strings shape to a single display string", () => {
    const { fieldErrors } = splitFieldErrors(
      { email: ["An account with this email already exists."] },
      new Set(["email"])
    );
    expect(fieldErrors).toEqual({
      email: "An account with this email already exists.",
    });
  });

  it("joins unmatched keys into a single form-level message instead of dropping them", () => {
    const { fieldErrors, formError } = splitFieldErrors(
      { non_field_errors: ["Invalid email or password."] },
      new Set(["email", "name"])
    );
    expect(fieldErrors).toEqual({});
    expect(formError).toBe("Invalid email or password.");
  });

  it("treats every message as form-level when knownFields is empty", () => {
    const { fieldErrors, formError } = splitFieldErrors(
      { non_field_errors: ["Invalid email or password."] },
      new Set()
    );
    expect(fieldErrors).toEqual({});
    expect(formError).toBe("Invalid email or password.");
  });
});
