import { describe, expect, it } from "vitest";
import { parseStoredTheme, resolveTheme } from "./theme";

describe("parseStoredTheme", () => {
  it("returns 'system' when nothing is stored", () => {
    expect(parseStoredTheme(null)).toBe("system");
  });

  it("returns 'system' for an empty string", () => {
    expect(parseStoredTheme("")).toBe("system");
  });

  it("returns 'system' for a value that is not a valid theme", () => {
    expect(parseStoredTheme("solarized")).toBe("system");
  });

  it("passes each valid stored value through unchanged", () => {
    expect(parseStoredTheme("light")).toBe("light");
    expect(parseStoredTheme("dark")).toBe("dark");
    expect(parseStoredTheme("system")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("resolves explicit 'light' regardless of the OS preference", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("resolves explicit 'dark' regardless of the OS preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("resolves 'system' by following the OS preference", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });
});
