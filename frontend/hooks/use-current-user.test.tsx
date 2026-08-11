import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setMockRole, clearMockRole } from "@/lib/auth/mock-session";
import { useCurrentUser } from "./use-current-user";

describe("useCurrentUser", () => {
  afterEach(() => {
    clearMockRole();
  });

  it("returns null when no mock role cookie is set (logged out)", async () => {
    const { result } = renderHook(() => useCurrentUser());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("returns the matching mock user when a role cookie is set", async () => {
    setMockRole("provider");
    const { result } = renderHook(() => useCurrentUser());
    await waitFor(() =>
      expect(result.current).toMatchObject({ role: "provider" })
    );
    expect(result.current?.name).toBeTruthy();
  });

  it("returns different mock users for different roles", async () => {
    setMockRole("admin");
    const { result } = renderHook(() => useCurrentUser());
    await waitFor(() =>
      expect(result.current).toMatchObject({ role: "admin" })
    );
  });
});
