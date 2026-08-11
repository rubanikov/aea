import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./LoginForm";

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

describe("LoginForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("has real labeled controls for email and password", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows specific inline validation errors and focuses the first invalid field on empty submit", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("flags a malformed email", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(
      screen.getByText("Enter a valid email address")
    ).toBeInTheDocument();
  });

  it("shows a loading state while submitting, then logs in and redirects to the role-appropriate route", async () => {
    mockFetchSequence([
      new Response("{}", { status: 200 }), // POST /auth/login
      new Response(
        JSON.stringify({
          id: "1",
          email: "pat@example.com",
          name: "Pat",
          role: "patient",
        }),
        { status: 200 }
      ), // GET /auth/me
    ]);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/patient"));
  });

  it("shows an inline, actionable message on invalid credentials (401) without redirecting", async () => {
    mockFetchSequence([new Response("", { status: 401 })]);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid email or password/i
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("also shows the invalid-credentials message for a 400 response with a non_field_errors body", async () => {
    mockFetchSequence([
      new Response(
        JSON.stringify({ non_field_errors: ["Invalid email or password."] }),
        { status: 400 }
      ),
    ]);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid email or password/i
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a rate-limit message on 429", async () => {
    mockFetchSequence([new Response("", { status: 429 })]);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many attempts/i
    );
  });

  it("disables the submit button and shows a loading label while the request is in flight", async () => {
    let resolveLogin: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveLogin = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(
      screen.getByRole("button", { name: /logging in/i })
    ).toBeDisabled();

    resolveLogin(new Response("", { status: 401 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^log in$/i })).not.toBeDisabled()
    );
  });
});
