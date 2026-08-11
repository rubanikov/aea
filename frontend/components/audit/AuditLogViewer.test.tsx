import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditLogViewer } from "./AuditLogViewer";
import type { AuditLogResponse } from "@/lib/audit/types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

function pageResponse(overrides: Partial<AuditLogResponse> = {}): Response {
  const body: AuditLogResponse = {
    results: [
      {
        id: "a1",
        actor: "7",
        action: "status:confirmed->completed",
        target_type: "appointment",
        target_id: "apt-42",
        timestamp: "2026-08-10T14:32:07.000Z",
      },
    ],
    count: 50,
    page: 1,
    page_size: 20,
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastFetchedUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const calls = fetchMock.mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe("AuditLogViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading indicator before the first fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AuditLogViewer />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading audit log/i);
  });

  it("renders the results table, the UTC/append-only note, and pagination on success", async () => {
    mockFetchSequence([pageResponse()]);
    render(<AuditLogViewer />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/all timestamps are utc/i)).toBeInTheDocument();
    expect(screen.getByText(/append-only/i)).toBeInTheDocument();
    expect(screen.getByText("2026-08-10 14:32:07Z")).toBeInTheDocument();
    expect(screen.getByText(/showing 1.*20 of 50/i)).toBeInTheDocument();
  });

  it("shows an empty state with a Clear filters action when there are no results", async () => {
    mockFetchSequence([pageResponse({ results: [], count: 0 })]);
    render(<AuditLogViewer />);

    expect(
      await screen.findByText(/no audit events match these filters/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear filters/i })
    ).toBeInTheDocument();
  });

  it("shows an actionable error with Retry if the fetch fails, and retries on click", async () => {
    const fetchMock = mockFetchSequence([
      new Response("", { status: 500 }),
      pageResponse(),
    ]);
    const user = userEvent.setup();
    render(<AuditLogViewer />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load the audit log/i
    );

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redirects to /login with a session-expired message on a 401, without showing the generic error", async () => {
    mockFetchSequence([new Response("", { status: 401 })]);
    render(<AuditLogViewer />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not fetch again just from typing in a filter field (no live filtering)", async () => {
    const fetchMock = mockFetchSequence([pageResponse(), pageResponse()]);
    const user = userEvent.setup();
    render(<AuditLogViewer />);

    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Actor (user ID)"), "7");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches with the entered filters, reset to page 1, when Apply is submitted", async () => {
    const fetchMock = mockFetchSequence([pageResponse(), pageResponse()]);
    const user = userEvent.setup();
    render(<AuditLogViewer />);

    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Actor (user ID)"), "7");
    await user.type(screen.getByLabelText("Action"), "status:confirmed->completed");
    await user.type(screen.getByLabelText("Target type"), "appointment");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = lastFetchedUrl(fetchMock);
    expect(url).toContain("actor=7");
    expect(url).toContain("action=status%3Aconfirmed-%3Ecompleted");
    expect(url).toContain("target_type=appointment");
    expect(url).toContain("page=1");

    expect(
      screen.getByText(/filtered by actor "7", action/i)
    ).toBeInTheDocument();
  });

  it("re-fetches page 1 with all filters cleared from the empty state's Clear filters action", async () => {
    const fetchMock = mockFetchSequence([
      pageResponse(),
      pageResponse({ results: [], count: 0 }),
      pageResponse(),
    ]);
    const user = userEvent.setup();
    render(<AuditLogViewer />);

    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Actor (user ID)"), "7");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/no audit events match these filters/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const url = lastFetchedUrl(fetchMock);
    expect(url).not.toContain("actor=");
    expect(url).toContain("page=1");
    expect(screen.getByLabelText("Actor (user ID)")).toHaveValue("");
  });

  it("moves to the next page and back, refetching with the right page param each time", async () => {
    const fetchMock = mockFetchSequence([
      pageResponse({ page: 1 }),
      pageResponse({ page: 2 }),
      pageResponse({ page: 1 }),
    ]);
    const user = userEvent.setup();
    render(<AuditLogViewer />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastFetchedUrl(fetchMock)).toContain("page=2");

    await user.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(lastFetchedUrl(fetchMock)).toContain("page=1");
  });
});
