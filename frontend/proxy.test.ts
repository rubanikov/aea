import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { MOCK_SESSION_COOKIE } from "./lib/auth/roles";

function requestFor(pathname: string, role?: string) {
  const url = `https://example.test${pathname}`;
  const init = role
    ? { headers: { cookie: `${MOCK_SESSION_COOKIE}=${role}` } }
    : undefined;
  return new NextRequest(url, init);
}

describe("proxy (route guard wired to the request's cookies)", () => {
  it("lets an unauthenticated request through to a public route", () => {
    const response = proxy(requestFor("/login"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request away from a provider-only route, rather than letting it render", () => {
    const response = proxy(requestFor("/provider"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });

  it("redirects a patient's request away from a provider-only route", () => {
    const response = proxy(requestFor("/provider", "patient"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/access-denied"
    );
  });

  it("lets a provider's request through to a provider route", () => {
    const response = proxy(requestFor("/provider", "provider"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request away from a nested admin route", () => {
    const response = proxy(requestFor("/admin/settings"));
    expect(response.headers.get("location")).toBe(
      "https://example.test/login"
    );
  });
});
