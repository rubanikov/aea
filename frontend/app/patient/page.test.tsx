import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PatientDashboardPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PatientDashboardPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the booking flow's provider picker", () => {
    // The providers request never resolves during this test; the picker
    // stays in its loading state, which is all this smoke test cares about.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PatientDashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Book an appointment", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText(/1\. choose a provider/i)).toBeInTheDocument();
    expect(screen.getByText(/loading providers/i)).toBeInTheDocument();
  });
});
