import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCurrentUser } from "./use-current-user";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

describe("useCurrentUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("is undefined (loading) before the GET /auth/me response resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current).toBeUndefined();
  });

  it("returns the authenticated user from GET /auth/me", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "u1",
            email: "riley@example.com",
            name: "Dr. Riley Provider",
            role: "provider",
          }),
          { status: 200 }
        )
      )
    );

    const { result } = renderHook(() => useCurrentUser());
    await waitFor(() =>
      expect(result.current).toMatchObject({ role: "provider" })
    );
    expect(result.current?.name).toBe("Dr. Riley Provider");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("resolves to null and redirects to /login with a session-expired message on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );

    const { result } = renderHook(() => useCurrentUser());
    await waitFor(() => expect(result.current).toBeNull());
    expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1");
  });
});
