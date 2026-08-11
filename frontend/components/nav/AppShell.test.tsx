import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { clearMockRole } from "@/lib/auth/mock-session";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("AppShell", () => {
  afterEach(() => {
    clearMockRole();
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
