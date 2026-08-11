/**
 * Shared role vocabulary. This is the one place that needs to keep matching
 * the backend's role enum (see `GET /auth/me`'s `role` field).
 */
export type Role = "patient" | "provider" | "admin";

export const ROLES: readonly Role[] = ["patient", "provider", "admin"];

export function isRole(value: string | null | undefined): value is Role {
  return value === "patient" || value === "provider" || value === "admin";
}
