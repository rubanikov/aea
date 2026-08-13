import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CurrentUser } from "@/hooks/use-current-user";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { SettingsShell } from "./SettingsShell";

const currentUser = vi.hoisted(() => ({
  value: undefined as CurrentUser | null | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings",
}));

// Mocking the hook covers both SettingsShell and the UserBadge inside
// AppShell, so no fetch stub is needed.
vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => currentUser.value,
}));

function renderSettingsShell() {
  return render(
    <ThemeProvider>
      <SettingsShell>
        <p>settings content</p>
      </SettingsShell>
    </ThemeProvider>
  );
}

function user(role: string): CurrentUser {
  return { id: "u1", email: "u@example.com", name: "U", role } as CurrentUser;
}

describe("SettingsShell", () => {
  it("shows the neutral loading header while the role is in flight", () => {
    currentUser.value = undefined;
    renderSettingsShell();
    expect(screen.getByRole("banner")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("settings content")).toBeInTheDocument();
  });

  it("renders the provider nav for a provider", () => {
    currentUser.value = user("provider");
    renderSettingsShell();
    expect(screen.getByText("Provider portal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/provider/calendar"
    );
  });

  it("renders the admin nav for an admin", () => {
    currentUser.value = user("admin");
    renderSettingsShell();
    expect(screen.getByText("Admin portal")).toBeInTheDocument();
  });

  it("falls back to the patient nav when the user is null", () => {
    currentUser.value = null;
    renderSettingsShell();
    expect(screen.getByText("Patient portal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/patient"
    );
  });

  it("falls back to the patient nav for an unknown role", () => {
    currentUser.value = user("superuser");
    renderSettingsShell();
    expect(screen.getByText("Patient portal")).toBeInTheDocument();
  });
});
