import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function requestFor(pathname: string, cookie?: string) {
  const url = `https://example.test${pathname}`;
  const init = cookie ? { headers: { cookie } } : undefined;
  return new NextRequest(url, init);
}

/** Mocks the backend's `GET /auth/me` response the guard calls out to. */
function mockAuthMe(
  result:
    | { status: 200; role: string }
    | { status: 401 }
    | { status: "network-error" }
) {
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (result.status === "network-error") {
      throw new Error("network unreachable");
    }
    if (result.status === 401) {
      return new Response("", { status: 401 });
    }
    return new Response(JSON.stringify({ role: result.role }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("proxy (route guard backed by GET /auth/me)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets an unauthenticated request through to a public route", async () => {
    mockAuthMe({ status: 401 });
    const response = await proxy(requestFor("/login"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request away from a provider-only route, rather than letting it render", async () => {
    mockAuthMe({ status: 401 });
    const response = await proxy(requestFor("/provider"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });

  it("redirects a patient's request away from a provider-only route", async () => {
    const fetchMock = mockAuthMe({ status: 200, role: "patient" });
    const response = await proxy(
      requestFor("/provider", "session=abc123")
    );
    expect(response.headers.get("location")).toBe(
      "https://example.test/access-denied"
    );
    // The incoming request's cookies are forwarded to /auth/me so the
    // backend can verify the same session.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.cookie).toBe("session=abc123");
  });

  it("lets a provider's request through to a provider route", async () => {
    mockAuthMe({ status: 200, role: "provider" });
    const response = await proxy(
      requestFor("/provider", "session=abc123")
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request away from a nested admin route", async () => {
    mockAuthMe({ status: 401 });
    const response = await proxy(requestFor("/admin/settings"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });

  it("redirects an unauthenticated request away from the account settings route", async () => {
    mockAuthMe({ status: 401 });
    const response = await proxy(requestFor("/settings"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });

  it("lets any authenticated role through to the account settings route", async () => {
    mockAuthMe({ status: 200, role: "admin" });
    const response = await proxy(
      requestFor("/settings", "session=abc123")
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("fails closed (redirects to /login) when the backend is unreachable", async () => {
    mockAuthMe({ status: "network-error" });
    const response = await proxy(
      requestFor("/patient", "session=abc123")
    );
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });
});
