import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminDashboardPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("AdminDashboardPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the audit log heading and viewer", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AdminDashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Audit log" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /filter audit log/i })
    ).toBeInTheDocument();
  });
});
