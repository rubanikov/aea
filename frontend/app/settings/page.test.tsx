import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    id: "u1",
    email: "riley@example.com",
    name: "Dr. Riley Provider",
    role: "provider",
  }),
}));

describe("SettingsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the profile and password sections, but no danger-zone/delete section (TICKET-14's scope)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Profile" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Password" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delete account/i)).not.toBeInTheDocument();
  });

  it("links back to the current user's role home", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<SettingsPage />);

    expect(
      screen.getByRole("link", { name: /back to dashboard/i })
    ).toHaveAttribute("href", "/provider");
  });
});
