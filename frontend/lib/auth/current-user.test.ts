import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { fetchCurrentUser } from "./current-user";

describe("fetchCurrentUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the user for a 200 response from GET /auth/me", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "u1",
            email: "pat@example.com",
            name: "Pat Patient",
            role: "patient",
          }),
          { status: 200 }
        )
      )
    );

    await expect(fetchCurrentUser()).resolves.toEqual({
      id: "u1",
      email: "pat@example.com",
      name: "Pat Patient",
      role: "patient",
    });
  });

  it("returns null for a 401 (no session)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("throws ApiError for a non-401 error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 }))
    );

    const error = await fetchCurrentUser().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it("normalizes a numeric id (Django's default integer PK) to a string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 1,
            email: "pat@example.com",
            name: "Pat Patient",
            role: "patient",
          }),
          { status: 200 }
        )
      )
    );

    await expect(fetchCurrentUser()).resolves.toEqual({
      id: "1",
      email: "pat@example.com",
      name: "Pat Patient",
      role: "patient",
    });
  });

  it("returns null if the payload doesn't carry a recognizable role", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "u1", role: "not-a-role" }), {
          status: 200,
        })
      )
    );

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });
});
