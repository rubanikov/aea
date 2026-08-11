import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProviderCalendarPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("ProviderCalendarPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the page heading and the calendar", () => {
    // The request never resolves during this test -- the calendar stays in
    // its loading state, which is all this smoke test cares about.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ProviderCalendarPage />);

    expect(
      screen.getByRole("heading", { name: "My Calendar", level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByText(/loading your calendar/i)).toBeInTheDocument();
  });
});
