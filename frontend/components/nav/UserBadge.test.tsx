import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setMockRole, clearMockRole, readMockRole } from "@/lib/auth/mock-session";
import { UserBadge } from "./UserBadge";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

describe("UserBadge", () => {
  afterEach(() => {
    clearMockRole();
    pushMock.mockClear();
  });

  it("shows a log-in link when no one is logged in", async () => {
    render(<UserBadge />);
    expect(await screen.findByRole("link", { name: /log in/i })).toHaveAttribute(
      "href",
      "/login"
    );
  });

  it("shows the mock user's name and role, and a log-out control, when logged in", async () => {
    setMockRole("provider");
    render(<UserBadge />);
    expect(await screen.findByTestId("current-user-role")).toHaveTextContent(
      "provider"
    );
    expect(screen.getByTestId("current-user-name")).not.toHaveTextContent("");
    expect(
      screen.getByRole("button", { name: /log out/i })
    ).toBeInTheDocument();
  });

  it("clears the mock session and navigates to /login when logging out", async () => {
    setMockRole("patient");
    const user = userEvent.setup();
    render(<UserBadge />);

    const logoutButton = await screen.findByRole("button", {
      name: /log out/i,
    });
    await user.click(logoutButton);

    await waitFor(() => expect(readMockRole()).toBeNull());
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
