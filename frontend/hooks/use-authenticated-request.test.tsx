import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/client";
import { useAuthenticatedRequest } from "./use-authenticated-request";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

describe("useAuthenticatedRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("resolves with the parsed body on success, without redirecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: "Pat" }), { status: 200 })
        )
    );
    const { result } = renderHook(() => useAuthenticatedRequest());

    await expect(result.current("/profile")).resolves.toEqual({
      name: "Pat",
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("redirects to /login with a session-expired message on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );
    const { result } = renderHook(() => useAuthenticatedRequest());

    await expect(result.current("/profile")).rejects.toBeInstanceOf(ApiError);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
  });

  it("does not redirect on a non-401 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 }))
    );
    const { result } = renderHook(() => useAuthenticatedRequest());

    await expect(result.current("/profile")).rejects.toBeInstanceOf(ApiError);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("on a 401, retries once after a successful silent refresh instead of redirecting", async () => {
    const fetchMock = vi
      .fn()
      // 1. original /profile request -> expired access token
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      // 2. POST /auth/refresh -> succeeds, cookies rotated
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      // 3. retried /profile request -> succeeds this time
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "Pat" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuthenticatedRequest());

    await expect(result.current("/profile")).resolves.toEqual({
      name: "Pat",
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/refresh");
  });

  it("redirects to /login if the retry after a successful refresh still 401s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 })) // original
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // refresh ok
      .mockResolvedValueOnce(new Response("", { status: 401 })); // retry still fails
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuthenticatedRequest());

    await expect(result.current("/profile")).rejects.toBeInstanceOf(ApiError);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
  });
});
