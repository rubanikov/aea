import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PatientAppointmentsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PatientAppointmentsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the heading, a 'Book new' link back to the booking flow, and the appointment list", () => {
    // The list request never resolves during this test; it stays in its
    // loading state, which is all this smoke test cares about.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PatientAppointmentsPage />);

    expect(
      screen.getByRole("heading", { name: "My Appointments", level: 1 })
    ).toBeInTheDocument();
    const bookNewLink = screen.getByRole("link", { name: "+ Book new" });
    expect(bookNewLink).toHaveAttribute("href", "/patient");
    expect(screen.getByText(/loading your appointments/i)).toBeInTheDocument();
  });
});
