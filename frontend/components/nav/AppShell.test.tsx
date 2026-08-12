import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Role } from "@/lib/auth/roles";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** AppShell mounts ThemeToggle, which needs the ThemeProvider context. */
function renderShell(role: Role, children: ReactNode) {
  return render(
    <ThemeProvider>
      <AppShell role={role}>{children}</AppShell>
    </ThemeProvider>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
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

  it("renders the provider nav links for role='provider'", () => {
    renderShell("provider", <p>provider content</p>);
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
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
});
