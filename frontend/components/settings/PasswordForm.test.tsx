import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordForm } from "./PasswordForm";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("PasswordForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("has real labeled controls for all three fields", () => {
    render(<PasswordForm />);
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("shows specific inline validation errors on empty submit", async () => {
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.click(
      screen.getByRole("button", { name: /update password/i })
    );

    expect(
      screen.getByText("Current password is required")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveFocus();
  });

  it("shows 'Passwords don't match' when the confirmation differs", async () => {
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Current password"), "oldpass1");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "newpass124"
    );
    await user.click(
      screen.getByRole("button", { name: /update password/i })
    );

    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
  });

  it("submits POST /profile/password with the expected shape and shows a success message", async () => {
    const fetchMock = mockFetchSequence([
      new Response("{}", { status: 200 }),
    ]);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Current password"), "oldpass1");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "newpass123"
    );
    await user.click(
      screen.getByRole("button", { name: /update password/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /password updated/i
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(
      JSON.stringify({
        current_password: "oldpass1",
        new_password: "newpass123",
      })
    );
  });

  it("shows a wrong-current-password error inline (DRF's list-of-strings shape), which clears once the field is edited again", async () => {
    mockFetchSequence([
      new Response(
        JSON.stringify({
          current_password: ["Current password is incorrect."],
        }),
        { status: 400 }
      ),
    ]);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Current password"), "wrongpass");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "newpass123"
    );
    await user.click(
      screen.getByRole("button", { name: /update password/i })
    );

    expect(
      await screen.findByText("Current password is incorrect.")
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Current password"), "x");

    expect(
      screen.queryByText("Current password is incorrect.")
    ).not.toBeInTheDocument();
  });

  it("redirects to /login with a session-expired message on a 401", async () => {
    mockFetchSequence([new Response("", { status: 401 })]);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await user.type(screen.getByLabelText("Current password"), "oldpass1");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "newpass123"
    );
    await user.click(
      screen.getByRole("button", { name: /update password/i })
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
  });
});
