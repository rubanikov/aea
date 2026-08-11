import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileForm } from "./ProfileForm";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const SAMPLE_PROFILE = {
  name: "Pat Patient",
  email: "pat@example.com",
  phone: "555-0100",
  timezone: "America/Chicago",
};

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ProfileForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state before GET /profile resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ProfileForm />);
    expect(screen.getByText(/loading your profile/i)).toBeInTheDocument();
  });

  it("loads and displays the profile fields", async () => {
    mockFetchSequence([
      new Response(JSON.stringify(SAMPLE_PROFILE), { status: 200 }),
    ]);
    render(<ProfileForm />);

    expect(await screen.findByLabelText("Name")).toHaveValue("Pat Patient");
    expect(screen.getByLabelText("Email")).toHaveValue("pat@example.com");
    expect(screen.getByLabelText("Phone")).toHaveValue("555-0100");
    expect(screen.getByLabelText("Timezone")).toHaveValue("America/Chicago");
  });

  it("shows an actionable error if the profile fails to load", async () => {
    mockFetchSequence([new Response("", { status: 500 })]);
    render(<ProfileForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your profile/i
    );
  });

  it("saves changes via PATCH /profile and shows a success message", async () => {
    mockFetchSequence([
      new Response(JSON.stringify(SAMPLE_PROFILE), { status: 200 }), // GET
      new Response(
        JSON.stringify({ ...SAMPLE_PROFILE, phone: "555-0199" }),
        { status: 200 }
      ), // PATCH
    ]);
    const user = userEvent.setup();
    render(<ProfileForm />);

    const phoneInput = await screen.findByLabelText("Phone");
    await user.clear(phoneInput);
    await user.type(phoneInput, "555-0199");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /profile updated/i
    );
    expect(phoneInput).toHaveValue("555-0199");
  });

  it("shows an inline, per-field error from a 400 response and focuses that field", async () => {
    mockFetchSequence([
      new Response(JSON.stringify(SAMPLE_PROFILE), { status: 200 }), // GET
      new Response(JSON.stringify({ email: "already in use" }), {
        status: 400,
      }), // PATCH
    ]);
    const user = userEvent.setup();
    render(<ProfileForm />);

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("already in use")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("normalizes DRF's list-of-strings error shape onto the field too", async () => {
    mockFetchSequence([
      new Response(JSON.stringify(SAMPLE_PROFILE), { status: 200 }), // GET
      new Response(JSON.stringify({ email: ["Enter a valid email address."] }), {
        status: 400,
      }), // PATCH
    ]);
    const user = userEvent.setup();
    render(<ProfileForm />);

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument();
  });

  it("redirects to /login with a session-expired message if the profile fetch 401s", async () => {
    mockFetchSequence([new Response("", { status: 401 })]);
    render(<ProfileForm />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
  });
});
