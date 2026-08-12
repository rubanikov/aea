import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeProvider";

/**
 * jsdom doesn't implement matchMedia; install a controllable stand-in so
 * tests can set the simulated OS preference and fire live "change" events.
 */
function mockMatchMedia({ prefersDark = false } = {}) {
  let matches = prefersDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (
      _: string,
      cb: (event: MediaQueryListEvent) => void
    ) => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(query));
  return {
    setPrefersDark(value: boolean) {
      matches = value;
      act(() => {
        for (const cb of listeners) {
          cb({ matches: value } as MediaQueryListEvent);
        }
      });
    },
  };
}

/** Minimal consumer exposing the context for assertions and interaction. */
function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme("light")}>go light</button>
      <button onClick={() => setTheme("dark")}>go dark</button>
      <button onClick={() => setTheme("system")}>go system</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    mockMatchMedia();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
  });

  it("setTheme('dark') adds the dark class; setTheme('light') removes it", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "go dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    await user.click(screen.getByRole("button", { name: "go light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("persists the choice to localStorage and reads it back on a later mount", async () => {
    const user = userEvent.setup();
    const first = renderProvider();

    await user.click(screen.getByRole("button", { name: "go dark" }));
    expect(window.localStorage.getItem("aea-theme")).toBe("dark");
    first.unmount();

    renderProvider();
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("adopts the resolved mode the pre-paint script applied to the DOM under 'system'", () => {
    // Simulate the pre-paint script having resolved system → dark.
    document.documentElement.classList.add("dark");
    renderProvider();
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("follows live OS preference changes while theme is 'system'", () => {
    const media = mockMatchMedia({ prefersDark: false });
    renderProvider();
    expect(document.documentElement).not.toHaveClass("dark");

    media.setPrefersDark(true);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    media.setPrefersDark(false);
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("stops following OS changes once an explicit theme is chosen", async () => {
    const user = userEvent.setup();
    const media = mockMatchMedia({ prefersDark: false });
    renderProvider();

    await user.click(screen.getByRole("button", { name: "go light" }));
    media.setPrefersDark(true);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("survives a throwing localStorage: no crash, switching still works in-memory", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    const user = userEvent.setup();
    renderProvider();
    expect(screen.getByTestId("theme")).toHaveTextContent("system");

    await user.click(screen.getByRole("button", { name: "go dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    await user.click(screen.getByRole("button", { name: "go light" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
