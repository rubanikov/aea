import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PatientBookPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PatientBookPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the booking wizard's provider step", () => {
    // The providers request never resolves during this test; the step
    // stays in its loading state, which is all this smoke test cares about.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PatientBookPage />);

    expect(
      screen.getByRole("heading", { name: "Book an appointment", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a provider" })).toBeInTheDocument();
    expect(screen.getByText(/loading providers/i)).toBeInTheDocument();
  });
});
