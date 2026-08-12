import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionMismatchNotice } from "./SessionMismatchNotice";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

function mockAuthMe(
  user: { id: string; email: string; name: string; role: string } | null
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response("", { status: 401 })
    )
  );
}

const DR_ROSSI = {
  id: "9",
  email: "rossi@example.com",
  name: "Dr. Ana Rossi",
  role: "provider",
};

describe("SessionMismatchNotice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("names the account that actually holds this browser's session", async () => {
    // The reported bug: a doctor tab and a patient tab open at once. The
    // second sign-in replaced the first, so the stranded tab must say *who*
    // the browser is now signed in as -- not just "access denied".
    mockAuthMe(DR_ROSSI);
    render(<SessionMismatchNotice requiredRole="patient" />);

    expect(await screen.findByTestId("signed-in-as")).toHaveTextContent(
      "Dr. Ana Rossi"
    );
    expect(screen.getByTestId("signed-in-as")).toHaveTextContent("provider");
  });

  it("explains that signing in elsewhere in this browser replaced the session", async () => {
    mockAuthMe(DR_ROSSI);
    render(<SessionMismatchNotice requiredRole="patient" />);

    expect(await screen.findByTestId("multi-tab-explanation")).toHaveTextContent(
      /every tab in this browser shares one session/i
    );
  });

  it("tells the visitor which kind of account the page needed", async () => {
    mockAuthMe(DR_ROSSI);
    render(<SessionMismatchNotice requiredRole="patient" />);

    expect(await screen.findByTestId("required-role")).toHaveTextContent(
      "patient"
    );
  });

  it("does not claim a session was replaced when the required role is unknown", async () => {
    mockAuthMe(DR_ROSSI);
    render(<SessionMismatchNotice requiredRole={null} />);

    expect(await screen.findByTestId("signed-in-as")).toBeInTheDocument();
    expect(screen.queryByTestId("required-role")).not.toBeInTheDocument();
  });

  it("explains the situation immediately, without waiting on the session lookup", () => {
    mockAuthMe(DR_ROSSI);
    render(<SessionMismatchNotice requiredRole="patient" />);

    // No flash of an unconfirmed identity before GET /auth/me resolves...
    expect(screen.queryByTestId("signed-in-as")).not.toBeInTheDocument();
    // ...but the explanation itself must not be held hostage to that
    // request, or the first thing the visitor sees is the bare "access
    // denied" this notice exists to replace.
    expect(screen.getByTestId("required-role")).toBeInTheDocument();
    expect(screen.getByTestId("multi-tab-explanation")).toBeInTheDocument();
  });
});
