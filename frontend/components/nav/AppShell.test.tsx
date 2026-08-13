import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Role } from "@/lib/auth/roles";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "./AppShell";

const pathname = vi.hoisted(() => ({ current: "/settings" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname.current,
}));

/** AppShell mounts ThemeToggle, which needs the ThemeProvider context. */
function renderShell(role: Role | null, children: ReactNode) {
  return render(
    <ThemeProvider>
      <AppShell role={role}>{children}</AppShell>
    </ThemeProvider>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    pathname.current = "/settings";
    // UserBadge (rendered inside AppShell) calls GET /auth/me on mount.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the patient nav links for role='patient'", () => {
    renderShell("patient", <p>patient content</p>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/patient"
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("labels the provider's first nav link 'Dashboard' pointing at the calendar", () => {
    renderShell("provider", <p>provider content</p>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/provider/calendar"
    );
    expect(screen.getByRole("link", { name: "Availability" })).toHaveAttribute(
      "href",
      "/provider"
    );
  });

  it("renders the admin nav links for role='admin'", () => {
    renderShell("admin", <p>admin content</p>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/admin"
    );
  });

  it("renders the page content passed as children", () => {
    renderShell("admin", <p>admin-only placeholder content</p>);
    expect(
      screen.getByText("admin-only placeholder content")
    ).toBeInTheDocument();
  });

  it("has a navigation landmark for keyboard/screen-reader users", () => {
    renderShell("patient", <p>content</p>);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it.each(["patient", "provider", "admin"] as const)(
    "shows the theme toggle in the header for role='%s'",
    (role) => {
      renderShell(role, <p>content</p>);
      expect(
        screen.getByRole("radiogroup", { name: "Theme" })
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
    }
  );

  it("marks the exact-match nav link with aria-current='page'", () => {
    pathname.current = "/provider/calendar";
    renderShell("provider", <p>content</p>);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.getByRole("link", { name: "Availability" })
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("never marks /provider and /provider/calendar current at once", () => {
    pathname.current = "/provider";
    renderShell("provider", <p>content</p>);
    expect(
      screen.getByRole("link", { name: "Availability" })
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  describe("role={null} loading state", () => {
    beforeEach(() => {
      // Keep GET /auth/me in flight so UserBadge stays in its own loading
      // state and contributes no "Log in" link to the header.
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    it("renders a busy header with no nav and no links", () => {
      renderShell(null, <p>content</p>);
      expect(screen.getByRole("banner")).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });

    it("still renders the theme toggle and the page content", () => {
      renderShell(null, <p>settings content while loading</p>);
      expect(
        screen.getByRole("radiogroup", { name: "Theme" })
      ).toBeInTheDocument();
      expect(
        screen.getByText("settings content while loading")
      ).toBeInTheDocument();
    });
  });
});
