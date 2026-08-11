import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, ApiError, apiFetch, apiJson } from "./client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always sends credentials so the httpOnly session cookie is included", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/me");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/me`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("JSON-serializes a request body and sets Content-Type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/login", {
      method: "POST",
      body: { email: "a@b.com", password: "x" },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(
      JSON.stringify({ email: "a@b.com", password: "x" })
    );
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("does not set Content-Type for a bodyless request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/me");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({});
  });

  it("sends X-Requested-With on unsafe methods (CSRF mitigation for the cookie-delivered auth token)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/logout", { method: "POST" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      "X-Requested-With": "XMLHttpRequest",
    });
  });

  it("does not send X-Requested-With on a safe GET request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/me");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty("X-Requested-With");
  });
});

describe("apiJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the parsed JSON body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "1" }), { status: 200 })
        )
    );
    await expect(apiJson("/auth/me")).resolves.toEqual({ id: "1" });
  });

  it("throws ApiError with the status and parsed field errors on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ email: "already registered" }), {
            status: 400,
          })
        )
    );

    const error = await apiJson("/auth/register").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({ email: "already registered" });
  });

  it("throws ApiError with a null body when the error response has no JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );
    const error = await apiJson("/auth/me").catch((e) => e);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).body).toBeNull();
  });
});
