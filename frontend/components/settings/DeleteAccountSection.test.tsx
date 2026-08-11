import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountSection } from "./DeleteAccountSection";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openConfirmPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /request deletion/i })
  );
}

describe("DeleteAccountSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it("renders the danger-zone card with a heading, warning icon and text (not color alone), and a request button", () => {
    render(<DeleteAccountSection />);

    expect(
      screen.getByRole("heading", { name: /request account & data deletion/i })
    ).toBeInTheDocument();
    // The warning icon is decorative; the framing has to survive on text alone.
    expect(screen.getByText(/not undoable once processed/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /request deletion/i })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });

  it("opens the confirm panel with a real labeled password field and warns about upcoming appointments, without firing a request", async () => {
    const fetchMock = mockFetchSequence([]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);

    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(
      screen.getByText(/cancelled automatically as part of this request/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm deletion request/i })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a password before the confirm action fires (a single click can't delete the account)", async () => {
    const fetchMock = mockFetchSequence([]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    expect(
      screen.getByText("Current password is required")
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancel returns to the card view without submitting", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "mypassword1");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /request deletion/i })
    ).toBeInTheDocument();
  });

  it("shows a wrong-password inline error (DRF's list-of-strings shape) on a 400, matching PasswordForm's pattern", async () => {
    mockFetchSequence([
      new Response(
        JSON.stringify({
          password: ["Incorrect password."],
        }),
        { status: 400 }
      ),
    ]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "wrongpass");
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    expect(
      await screen.findByText("Incorrect password.")
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while the deletion request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "mypassword1");
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    const submitButton = screen.getByRole("button", { name: /deleting/i });
    expect(submitButton).toBeDisabled();

    resolveFetch(
      new Response(JSON.stringify({ cancelled_appointments_count: 0 }), {
        status: 200,
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it("on success, shows a confirmation and fully ends the client session (redirect + refresh, not a silent logout)", async () => {
    mockFetchSequence([
      new Response(JSON.stringify({ cancelled_appointments_count: 0 }), {
        status: 200,
      }),
    ]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "mypassword1");
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /your account has been deleted/i
    );
    expect(pushMock).toHaveBeenCalledWith("/login?account_deleted=1");
    expect(refreshMock).toHaveBeenCalled();
    // The danger-zone card is gone, replaced by the confirmation.
    expect(
      screen.queryByRole("button", { name: /request deletion/i })
    ).not.toBeInTheDocument();
  });

  it("sends POST /profile/delete-account with the password as the body", async () => {
    const fetchMock = mockFetchSequence([
      new Response(JSON.stringify({ cancelled_appointments_count: 0 }), {
        status: 200,
      }),
    ]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "mypassword1");
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/profile/delete-account");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ password: "mypassword1" }));
  });

  it("redirects to /login with a session-expired message on a 401 (handled by useAuthenticatedRequest)", async () => {
    mockFetchSequence([new Response("", { status: 401 })]);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openConfirmPanel(user);
    await user.type(screen.getByLabelText("Current password"), "mypassword1");
    await user.click(
      screen.getByRole("button", { name: /confirm deletion request/i })
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
  });
});
