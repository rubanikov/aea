import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthPageClient } from "./AuthPageClient";

let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}));

describe("AuthPageClient", () => {
  afterEach(() => {
    currentSearchParams = new URLSearchParams();
  });

  it("shows the login form by default", () => {
    render(<AuthPageClient />);
    expect(
      screen.getAllByRole("button", { name: /^log in$/i })
    ).toHaveLength(2); // the "Log in" tab and the form's submit button
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  });

  it("switches to the register form when the Sign up tab is chosen", async () => {
    const user = userEvent.setup();
    render(<AuthPageClient />);

    const signUpTab = screen.getByRole("button", { name: /sign up/i });
    expect(signUpTab).toHaveAttribute("aria-pressed", "false");

    await user.click(signUpTab);

    expect(signUpTab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i })
    ).toBeInTheDocument();
  });

  it("shows the session-expired message when the query param is set", () => {
    currentSearchParams = new URLSearchParams("session_expired=1");
    render(<AuthPageClient />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /session expired/i
    );
  });

  it("shows no session-expired message on a plain visit", () => {
    render(<AuthPageClient />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the account-deleted confirmation when the query param is set (post-deletion redirect)", () => {
    currentSearchParams = new URLSearchParams("account_deleted=1");
    render(<AuthPageClient />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /account has been deleted/i
    );
  });
});
