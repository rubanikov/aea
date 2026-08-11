import { describe, expect, it } from "vitest";
import { resolveRouteAccess } from "./route-guard";

describe("resolveRouteAccess", () => {
  it("allows public routes for anyone, including unauthenticated visitors", () => {
    expect(resolveRouteAccess("/", null)).toEqual({ allowed: true });
    expect(resolveRouteAccess("/login", null)).toEqual({ allowed: true });
  });

  it("redirects an unauthenticated visitor away from a patient-only route", () => {
    expect(resolveRouteAccess("/patient", null)).toEqual({
      allowed: false,
      redirectTo: "/login",
    });
  });

  it("redirects an unauthenticated visitor away from a nested provider-only route", () => {
    expect(resolveRouteAccess("/provider/schedule", null)).toEqual({
      allowed: false,
      redirectTo: "/login",
    });
  });

  it("redirects a patient visiting a provider-only route", () => {
    expect(resolveRouteAccess("/provider", "patient")).toEqual({
      allowed: false,
      redirectTo: "/access-denied",
    });
  });

  it("redirects a provider visiting an admin-only route", () => {
    expect(resolveRouteAccess("/admin/users", "provider")).toEqual({
      allowed: false,
      redirectTo: "/access-denied",
    });
  });

  it("allows a patient to visit patient routes", () => {
    expect(resolveRouteAccess("/patient", "patient")).toEqual({
      allowed: true,
    });
    expect(resolveRouteAccess("/patient/appointments", "patient")).toEqual({
      allowed: true,
    });
  });

  it("allows a provider to visit provider routes", () => {
    expect(resolveRouteAccess("/provider", "provider")).toEqual({
      allowed: true,
    });
  });

  it("allows an admin to visit admin routes", () => {
    expect(resolveRouteAccess("/admin", "admin")).toEqual({ allowed: true });
  });

  it("does not treat a route that merely starts with the same letters as gated", () => {
    // /patients (no trailing segment separator) must not match the /patient guard
    expect(resolveRouteAccess("/patients", null)).toEqual({ allowed: true });
  });

  it("rejects a garbage role value the same as unauthenticated for a gated route", () => {
    expect(resolveRouteAccess("/admin", "not-a-real-role")).toEqual({
      allowed: false,
      redirectTo: "/access-denied",
    });
  });
});
