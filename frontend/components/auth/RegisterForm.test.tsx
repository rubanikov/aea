import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterForm } from "./RegisterForm";

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

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Pat Patient");
  await user.type(screen.getByLabelText("Email"), "pat@example.com");
  await user.type(screen.getByLabelText("Password"), "longenough1");
  await user.type(screen.getByLabelText("Confirm password"), "longenough1");
}

describe("RegisterForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("has real labeled controls for every field", () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  });

  it("shows specific inline validation errors and focuses the first invalid field on empty submit", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("shows a specific 'Passwords don't match' error and does not submit", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText("Name"), "Pat Patient");
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.type(screen.getByLabelText("Confirm password"), "different1");
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
  });

  it("maps a server field error (e.g. already-registered email) onto the email field", async () => {
    mockFetchSequence([
      new Response(JSON.stringify({ email: "already registered" }), {
        status: 400,
      }),
    ]);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    expect(
      await screen.findByText("already registered")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("also normalizes DRF's list-of-strings error shape onto the field", async () => {
    mockFetchSequence([
      new Response(
        JSON.stringify({
          email: ["An account with this email already exists."],
        }),
        { status: 400 }
      ),
    ]);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    expect(
      await screen.findByText("An account with this email already exists.")
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("registers, logs in, and redirects to the role-appropriate route on success", async () => {
    mockFetchSequence([
      new Response(JSON.stringify({ id: "1" }), { status: 201 }), // POST /auth/register
      new Response("{}", { status: 200 }), // POST /auth/login
      new Response(
        JSON.stringify({
          id: "1",
          email: "pat@example.com",
          name: "Pat Patient",
          role: "patient",
        }),
        { status: 200 }
      ), // GET /auth/me
    ]);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/patient"));
  });

  it("calls onRegisteredButLoginFailed if registration succeeds but the follow-up login fails", async () => {
    mockFetchSequence([
      new Response(JSON.stringify({ id: "1" }), { status: 201 }), // POST /auth/register
      new Response("", { status: 401 }), // POST /auth/login (unexpected failure)
    ]);
    const onRegisteredButLoginFailed = vi.fn();
    const user = userEvent.setup();
    render(
      <RegisterForm onRegisteredButLoginFailed={onRegisteredButLoginFailed} />
    );

    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    await waitFor(() =>
      expect(onRegisteredButLoginFailed).toHaveBeenCalledWith(
        "pat@example.com"
      )
    );
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveRegister: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRegister = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<RegisterForm />);
    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /create account/i })
    );

    expect(
      screen.getByRole("button", { name: /creating account/i })
    ).toBeDisabled();

    resolveRegister(new Response("", { status: 400 }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^create account$/i })
      ).not.toBeDisabled()
    );
  });
});
