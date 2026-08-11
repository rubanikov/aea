import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserBadge } from "./UserBadge";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function mockAuthMe(
  user: { id: string; email: string; name: string; role: string } | null
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: string) => {
      if (typeof input === "string" && input.includes("/auth/logout")) {
        return new Response("", { status: 200 });
      }
      return user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response("", { status: 401 });
    })
  );
}

describe("UserBadge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it("shows a log-in link once GET /auth/me resolves with no session", async () => {
    mockAuthMe(null);
    render(<UserBadge />);
    expect(await screen.findByRole("link", { name: /log in/i })).toHaveAttribute(
      "href",
      "/login"
    );
  });

  it("shows the user's name and role, and a log-out control, when logged in", async () => {
    mockAuthMe({
      id: "u1",
      email: "riley@example.com",
      name: "Dr. Riley Provider",
      role: "provider",
    });
    render(<UserBadge />);
    expect(await screen.findByTestId("current-user-role")).toHaveTextContent(
      "provider"
    );
    expect(screen.getByTestId("current-user-name")).toHaveTextContent(
      "Dr. Riley Provider"
    );
    expect(
      screen.getByRole("button", { name: /log out/i })
    ).toBeInTheDocument();
  });

  it("calls POST /auth/logout and navigates to /login when logging out", async () => {
    mockAuthMe({
      id: "u1",
      email: "pat@example.com",
      name: "Pat Patient",
      role: "patient",
    });
    const user = userEvent.setup();
    render(<UserBadge />);

    const logoutButton = await screen.findByRole("button", {
      name: /log out/i,
    });
    await user.click(logoutButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
    expect(refreshMock).toHaveBeenCalled();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        String(url).includes("/auth/logout") && init?.method === "POST"
      )
    ).toBe(true);
  });
});
