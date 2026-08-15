import { describe, expect, it } from "vitest";
import { apiProxyRewrites } from "./proxy-rewrites";

describe("apiProxyRewrites", () => {
  it("forwards auth, profile, bookings, scheduling, and audit-log to Django", () => {
    const rules = apiProxyRewrites("https://backend.example.test/");

    expect(rules).toEqual([
      {
        source: "/auth/:path*",
        destination: "https://backend.example.test/auth/:path*",
      },
      {
        source: "/profile",
        destination: "https://backend.example.test/profile",
      },
      {
        source: "/profile/:path*",
        destination: "https://backend.example.test/profile/:path*",
      },
      {
        source: "/bookings",
        destination: "https://backend.example.test/bookings",
      },
      {
        source: "/bookings/:path*",
        destination: "https://backend.example.test/bookings/:path*",
      },
      {
        source: "/scheduling/:path*",
        destination: "https://backend.example.test/scheduling/:path*",
      },
      {
        source: "/audit-log",
        destination: "https://backend.example.test/audit-log",
      },
    ]);
  });

  it("does not proxy /admin, which is the Next.js admin portal", () => {
    const sources = apiProxyRewrites("https://backend.example.test").map(
      (rule) => rule.source
    );
    expect(sources.some((source) => source.startsWith("/admin"))).toBe(false);
  });
});
