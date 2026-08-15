import { afterEach, describe, expect, it, vi } from "vitest";
import { backendOrigin } from "./backend-origin";

describe("backendOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers BACKEND_URL when set, stripping a trailing slash", () => {
    vi.stubEnv("BACKEND_URL", "https://backend.example.test/");
    vi.stubEnv(
      "RAILWAY_SERVICE_BACKEND_URL",
      "backend-production.up.railway.app"
    );
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://frontend.example.test");

    expect(backendOrigin()).toBe("https://backend.example.test");
  });

  it("uses the Railway backend public hostname when BACKEND_URL is unset", () => {
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv(
      "RAILWAY_SERVICE_BACKEND_URL",
      "backend-production.up.railway.app"
    );
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://frontend.example.test");

    expect(backendOrigin()).toBe(
      "https://backend-production.up.railway.app"
    );
  });

  it("falls back to NEXT_PUBLIC_API_URL, then local Django", () => {
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("RAILWAY_SERVICE_BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000");

    expect(backendOrigin()).toBe("http://localhost:8000");
  });
});
