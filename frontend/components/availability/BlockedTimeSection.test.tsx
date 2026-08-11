import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockedTimeSection } from "./BlockedTimeSection";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const BLOCKED_TIME_PATH = "/scheduling/blocked-time";

// Exactly the wireframe's (Screen 6) two example rows, in UTC as the API
// would send them for a provider on America/New_York (EDT, UTC-4 in both
// August and September).
const SAMPLE_BLOCKS = [
  {
    id: 1,
    label: "Vacation",
    start: "2026-08-24T04:00:00.000Z",
    end: "2026-08-30T03:59:00.000Z",
  },
  {
    id: 2,
    label: "Conference (half day)",
    start: "2026-09-03T17:00:00.000Z",
    end: "2026-09-03T21:00:00.000Z",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Routes `fetch` by pathname -- this section fires two independent requests
 * on mount (blocked time + the timezone-conversion `GET /profile`), so
 * tests shouldn't be coupled to which fires first. `/profile` defaults to a
 * successful America/New_York response unless a test overrides it.
 */
function mockFetchRouter(
  overrides: Partial<
    Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>
  >
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const handler = overrides[path];
    if (handler) {
      return Promise.resolve(handler(init));
    }
    if (path === "/profile") {
      return Promise.resolve(jsonResponse({ timezone: "America/New_York" }));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("BlockedTimeSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching", () => {
    mockFetchRouter({ [BLOCKED_TIME_PATH]: () => new Promise(() => {}) });
    render(<BlockedTimeSection />);

    expect(screen.getByText(/loading blocked time/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when the list fails to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [BLOCKED_TIME_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(SAMPLE_BLOCKS);
      },
    });
    const user = userEvent.setup();
    render(<BlockedTimeSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your blocked time/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Vacation")).toBeInTheDocument();
  });

  it("renders 'No blocked time yet' cleanly, with an Add block CTA, when there is none", async () => {
    mockFetchRouter({ [BLOCKED_TIME_PATH]: () => jsonResponse([]) });
    render(<BlockedTimeSection />);

    expect(
      await screen.findByText(
        "No blocked time yet. Add vacation or a one-off block — it stacks on top of your weekly hours."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add block" })).toBeInTheDocument();
    expect(screen.queryByText("Upcoming blocks")).not.toBeInTheDocument();
  });

  it("renders each block's label and its date/time range in the provider's own timezone, with disambiguating remove buttons", async () => {
    mockFetchRouter({ [BLOCKED_TIME_PATH]: () => jsonResponse(SAMPLE_BLOCKS) });
    render(<BlockedTimeSection />);

    expect(await screen.findByText("Vacation")).toBeInTheDocument();
    expect(
      screen.getByText("Aug 24, 2026 00:00 → Aug 29, 2026 23:59 (America/New_York)")
    ).toBeInTheDocument();
    expect(screen.getByText("Conference (half day)")).toBeInTheDocument();
    expect(
      screen.getByText("Sep 3, 2026 13:00 → Sep 3, 2026 17:00 (America/New_York)")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Vacation (Aug 24, 2026 00:00 → Aug 29, 2026 23:59 (America/New_York))",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Conference (half day) (Sep 3, 2026 13:00 → Sep 3, 2026 17:00 (America/New_York))",
      })
    ).toBeInTheDocument();
  });

  it("defaults an unlabeled block's display name to 'Blocked'", async () => {
    mockFetchRouter({
      [BLOCKED_TIME_PATH]: () =>
        // The real API sends "" (not null) for an unset label -- a plain
        // `CharField(blank=True)`, confirmed against
        // `backend/scheduling/tests/test_blocked_time_api.py`.
        jsonResponse([{ id: 5, label: "", start: SAMPLE_BLOCKS[0].start, end: SAMPLE_BLOCKS[0].end }]),
    });
    render(<BlockedTimeSection />);

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
  });

  it("opens the add form focused on From date, validates all fields inline, and rejects a 'to' before 'from'", async () => {
    mockFetchRouter({ [BLOCKED_TIME_PATH]: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<BlockedTimeSection />);

    await user.click(await screen.findByRole("button", { name: "Add block" }));
    expect(screen.getByLabelText("From date")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Save block" }));
    expect(screen.getByText("From date is required")).toBeInTheDocument();
    expect(screen.getByText("From time is required")).toBeInTheDocument();
    expect(screen.getByText("To date is required")).toBeInTheDocument();
    expect(screen.getByText("To time is required")).toBeInTheDocument();
    expect(screen.getByLabelText("From date")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-08-24" },
    });
    fireEvent.change(screen.getByLabelText("From time"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.change(screen.getByLabelText("To time"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: "Save block" }));

    expect(screen.getByText("End must be after start")).toBeInTheDocument();
    expect(
      screen.queryByText("From date is required")
    ).not.toBeInTheDocument();
  });

  it("adds a blocked-time range: converts the local date/time fields to UTC using the provider's timezone, POSTs, and shows the new row", async () => {
    const fetchMock = mockFetchRouter({
      [BLOCKED_TIME_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([]);
        }
        if (init.method === "POST") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ id: 9, label: "", ...body }, 201);
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<BlockedTimeSection />);

    await user.click(await screen.findByRole("button", { name: "Add block" }));
    await user.type(screen.getByLabelText("Label (optional)"), "Vacation");
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-08-24" },
    });
    fireEvent.change(screen.getByLabelText("From time"), {
      target: { value: "00:00" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-08-24" },
    });
    fireEvent.change(screen.getByLabelText("To time"), {
      target: { value: "17:00" },
    });
    await user.click(screen.getByRole("button", { name: "Save block" }));

    expect(await screen.findByText("Vacation")).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    // America/New_York is UTC-4 (EDT) in August: 00:00 local -> 04:00Z,
    // 17:00 local -> 21:00Z.
    expect(
      JSON.parse((postCall?.[1] as RequestInit).body as string)
    ).toEqual({
      label: "Vacation",
      start: "2026-08-24T04:00:00.000Z",
      end: "2026-08-24T21:00:00.000Z",
    });
  });

  it("requires confirmation before removing a block, and only DELETEs after confirming", async () => {
    const fetchMock = mockFetchRouter({
      [BLOCKED_TIME_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse(SAMPLE_BLOCKS);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      [`${BLOCKED_TIME_PATH}/2`]: (init) => {
        if (init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<BlockedTimeSection />);

    const removeConference = await screen.findByRole("button", {
      name: "Remove Conference (half day) (Sep 3, 2026 13:00 → Sep 3, 2026 17:00 (America/New_York))",
    });
    await user.click(removeConference);
    expect(screen.getByText(/remove conference \(half day\)\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Conference (half day)")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).endsWith("/2"))
    ).toBe(false);

    await user.click(
      screen.getByRole("button", {
        name: "Remove Conference (half day) (Sep 3, 2026 13:00 → Sep 3, 2026 17:00 (America/New_York))",
      })
    );
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() =>
      expect(screen.queryByText("Conference (half day)")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Vacation")).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [BLOCKED_TIME_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<BlockedTimeSection />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
