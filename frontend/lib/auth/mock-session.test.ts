import { afterEach, describe, expect, it } from "vitest";
import { MOCK_SESSION_COOKIE } from "./roles";
import { clearMockRole, readMockRole, setMockRole } from "./mock-session";

function clearAllCookies() {
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  });
}

describe("mock session cookie helpers", () => {
  afterEach(() => {
    clearAllCookies();
  });

  it("reads null when no mock role cookie is set", () => {
    expect(readMockRole()).toBeNull();
  });

  it("reads back a role written with setMockRole", () => {
    setMockRole("provider");
    expect(readMockRole()).toBe("provider");
  });

  it("ignores a cookie value that isn't a real role", () => {
    document.cookie = `${MOCK_SESSION_COOKIE}=not-a-role; path=/`;
    expect(readMockRole()).toBeNull();
  });

  it("clears the cookie so reads go back to null", () => {
    setMockRole("admin");
    clearMockRole();
    expect(readMockRole()).toBeNull();
  });
});
