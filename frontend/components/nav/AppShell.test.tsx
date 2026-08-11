import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
    render(
      <AppShell role="patient">
        <p>patient content</p>
      </AppShell>
    );
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
    render(
      <AppShell role="provider">
        <p>provider content</p>
      </AppShell>
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/provider"
    );
  });

  it("renders the admin nav links for role='admin'", () => {
    render(
      <AppShell role="admin">
        <p>admin content</p>
      </AppShell>
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/admin"
    );
  });

  it("renders the page content passed as children", () => {
    render(
      <AppShell role="admin">
        <p>admin-only placeholder content</p>
      </AppShell>
    );
    expect(
      screen.getByText("admin-only placeholder content")
    ).toBeInTheDocument();
  });

  it("has a navigation landmark for keyboard/screen-reader users", () => {
    render(
      <AppShell role="patient">
        <p>content</p>
      </AppShell>
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
