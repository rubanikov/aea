import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProviderAvailabilityPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("ProviderAvailabilityPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the appointment types and weekly working hours sections", () => {
    // Neither request in either section resolves during this test -- both
    // stay in their loading state, which is all this smoke test cares about.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ProviderAvailabilityPage />);

    expect(
      screen.getByRole("heading", { name: "Availability settings", level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Appointment types" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Weekly working hours" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Blocked time" })
    ).toBeInTheDocument();
  });
});
