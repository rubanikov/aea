import { describe, expect, it } from "vitest";
import {
  validateDeleteAccount,
  validateLogin,
  validatePasswordChange,
  validateRegister,
} from "./validation";

describe("validateLogin", () => {
  it("requires an email and password", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({
      email: "Email is required",
      password: "Password is required",
    });
  });

  it("flags a malformed email", () => {
    expect(
      validateLogin({ email: "not-an-email", password: "secret123" })
    ).toEqual({ email: "Enter a valid email address" });
  });

  it("passes for a well-formed email and non-empty password", () => {
    expect(
      validateLogin({ email: "pat@example.com", password: "secret123" })
    ).toEqual({});
  });
});

describe("validateRegister", () => {
  it("requires name, email, and password", () => {
    const errors = validateRegister({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    });
    expect(errors.name).toBe("Name is required");
    expect(errors.email).toBe("Email is required");
    expect(errors.password).toBe("Password is required");
  });

  it("flags a password below the minimum length", () => {
    const errors = validateRegister({
      name: "Pat Patient",
      email: "pat@example.com",
      password: "short",
      confirmPassword: "short",
    });
    expect(errors.password).toBe("Password must be at least 8 characters");
  });

  it("flags mismatched passwords with a specific message", () => {
    const errors = validateRegister({
      name: "Pat Patient",
      email: "pat@example.com",
      password: "longenough1",
      confirmPassword: "longenough2",
    });
    expect(errors.confirmPassword).toBe("Passwords don't match");
  });

  it("passes for valid, matching input", () => {
    expect(
      validateRegister({
        name: "Pat Patient",
        email: "pat@example.com",
        password: "longenough1",
        confirmPassword: "longenough1",
      })
    ).toEqual({});
  });
});

describe("validatePasswordChange", () => {
  it("requires current and new passwords", () => {
    const errors = validatePasswordChange({
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    });
    expect(errors.currentPassword).toBe("Current password is required");
    expect(errors.newPassword).toBe("New password is required");
  });

  it("flags mismatched confirmation with a specific message", () => {
    const errors = validatePasswordChange({
      currentPassword: "oldpass1",
      newPassword: "newpass123",
      confirmNewPassword: "newpass124",
    });
    expect(errors.confirmNewPassword).toBe("Passwords don't match");
  });

  it("passes for valid, matching input", () => {
    expect(
      validatePasswordChange({
        currentPassword: "oldpass1",
        newPassword: "newpass123",
        confirmNewPassword: "newpass123",
      })
    ).toEqual({});
  });
});

describe("validateDeleteAccount", () => {
  it("requires the current password", () => {
    expect(validateDeleteAccount({ currentPassword: "" })).toEqual({
      currentPassword: "Current password is required",
    });
  });

  it("passes once a password is entered", () => {
    expect(
      validateDeleteAccount({ currentPassword: "oldpass1" })
    ).toEqual({});
  });
});
