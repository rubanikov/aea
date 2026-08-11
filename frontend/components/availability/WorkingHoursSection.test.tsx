import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkingHoursSection } from "./WorkingHoursSection";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const AVAILABILITY_PATH = "/scheduling/availability";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Routes `fetch` by exact pathname (`/scheduling/availability` for the
 * collection, `/scheduling/availability/<id>` for a row's `DELETE`) rather
 * than call order, since the real API (confirmed against
 * `backend/scheduling/views.py`) has no bulk save endpoint -- saving a
 * changed day does a `DELETE` per stale row plus a fresh `POST`, then a
 * final `GET` to refresh from source of truth.
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
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WorkingHoursSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching", () => {
    mockFetchRouter({ [AVAILABILITY_PATH]: () => new Promise(() => {}) });
    render(<WorkingHoursSection />);

    expect(screen.getByText(/loading working hours/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when loading fails, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [AVAILABILITY_PATH]: () => {
        calls += 1;
        return calls === 1 ? new Response("", { status: 500 }) : jsonResponse([]);
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your working hours/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(
      await screen.findByText(/you haven't set your working hours yet/i)
    ).toBeInTheDocument();
  });

  it("shows the empty-state banner and every weekday as unavailable when no hours are set yet", async () => {
    mockFetchRouter({ [AVAILABILITY_PATH]: () => jsonResponse([]) });
    render(<WorkingHoursSection />);

    expect(
      await screen.findByText(/you haven't set your working hours yet/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /days available/i })).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(7);
    expect(screen.getByLabelText("Monday")).not.toBeChecked();
  });

  it("reveals start/end time inputs, defaulting to 09:00-17:00, when a day is checked", async () => {
    mockFetchRouter({ [AVAILABILITY_PATH]: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));

    expect(screen.getByLabelText("Monday start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday end time")).toHaveValue("17:00");
  });

  it("renders previously saved hours (day_of_week as an integer, times with seconds) pre-filled and checked, with the empty-state banner hidden", async () => {
    mockFetchRouter({
      [AVAILABILITY_PATH]: () =>
        // Monday=0, Friday=4 -- matches backend/scheduling/models.py's
        // `Availability.DayOfWeek` (Python's date.weekday()).
        jsonResponse([
          { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" },
          { id: 2, day_of_week: 4, start_time: "09:00:00", end_time: "13:00:00" },
        ]),
    });
    render(<WorkingHoursSection />);

    expect(await screen.findByLabelText("Monday")).toBeChecked();
    expect(screen.getByLabelText("Monday start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Friday end time")).toHaveValue("13:00");
    expect(screen.getByLabelText("Tuesday")).not.toBeChecked();
    expect(
      screen.queryByText(/you haven't set your working hours yet/i)
    ).not.toBeInTheDocument();
  });

  it("rejects an end time before the start time with a row-specific inline error, and does not save", async () => {
    const fetchMock = mockFetchRouter({ [AVAILABILITY_PATH]: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    fireEvent.change(screen.getByLabelText("Monday start time"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Monday end time"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(screen.getByText("End time must be after start time")).toBeInTheDocument();
    expect(screen.getByLabelText("Monday start time")).toHaveFocus();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST"
      )
    ).toHaveLength(0);
  });

  it("clears a row's error once its time is edited again", async () => {
    mockFetchRouter({ [AVAILABILITY_PATH]: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    fireEvent.change(screen.getByLabelText("Monday start time"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Monday end time"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));
    expect(screen.getByText("End time must be after start time")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Monday end time"), {
      target: { value: "18:00" },
    });

    expect(
      screen.queryByText("End time must be after start time")
    ).not.toBeInTheDocument();
  });

  it("saves a newly enabled day: POSTs it (day_of_week=0 for Monday), refreshes, and shows success feedback", async () => {
    // A minimal in-memory store so the post-save refresh GET reflects what
    // was just POSTed, the way a real backend would.
    const store: Array<{ id: number; day_of_week: number; start_time: string; end_time: string }> = [];
    const fetchMock = mockFetchRouter({
      [AVAILABILITY_PATH]: (init) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return jsonResponse(store);
        }
        if (method === "POST") {
          const body = JSON.parse(init!.body as string);
          const created = { id: store.length + 1, ...body };
          store.push(created);
          return jsonResponse(created, 201);
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /working hours saved/i
    );
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(
      JSON.parse((postCall?.[1] as RequestInit).body as string)
    ).toEqual({ day_of_week: 0, start_time: "09:00", end_time: "17:00" });
    expect(
      screen.queryByText(/you haven't set your working hours yet/i)
    ).not.toBeInTheDocument();
  });

  it("saves an edited day by deleting the old row and posting the new one, and leaves untouched days alone", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetchMock = mockFetchRouter({
      [AVAILABILITY_PATH]: (init) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return jsonResponse([
            { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" },
            { id: 2, day_of_week: 4, start_time: "09:00:00", end_time: "13:00:00" },
          ]);
        }
        if (method === "POST") {
          const body = JSON.parse(init!.body as string);
          calls.push({ method, path: AVAILABILITY_PATH, body });
          return jsonResponse({ id: 3, ...body }, 201);
        }
        throw new Error("unexpected call");
      },
      [`${AVAILABILITY_PATH}/1`]: (init) => {
        if (init?.method === "DELETE") {
          calls.push({ method: "DELETE", path: `${AVAILABILITY_PATH}/1` });
          return new Response(null, { status: 204 });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const mondayEnd = await screen.findByLabelText("Monday end time");
    fireEvent.change(mondayEnd, { target: { value: "18:00" } });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /working hours saved/i
    );
    expect(calls).toEqual([
      { method: "DELETE", path: `${AVAILABILITY_PATH}/1` },
      {
        method: "POST",
        path: AVAILABILITY_PATH,
        body: { day_of_week: 0, start_time: "09:00", end_time: "18:00" },
      },
    ]);
    // Friday (id 2) was never touched -- no DELETE for it.
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).endsWith("/2"))
    ).toBe(false);
  });

  it("shows a row-specific error and keeps the rest of the changes when one day's save is rejected by the server", async () => {
    mockFetchRouter({
      [AVAILABILITY_PATH]: (init) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return jsonResponse([]);
        }
        if (method === "POST") {
          const body = JSON.parse(init!.body as string) as { day_of_week: number };
          if (body.day_of_week === 0) {
            return jsonResponse(
              { end_time: "end_time must be after start_time." },
              400
            );
          }
          return jsonResponse({ id: 10 + body.day_of_week, ...body }, 201);
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    await user.click(await screen.findByLabelText("Tuesday"));
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(
      await screen.findByText("end_time must be after start_time.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("focuses Monday's checkbox when the empty-state CTA is clicked", async () => {
    mockFetchRouter({ [AVAILABILITY_PATH]: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /set up working hours/i })
    );

    expect(screen.getByLabelText("Monday")).toHaveFocus();
  });

  it("redirects to /login with a session-expired message on a 401 while loading", async () => {
    mockFetchRouter({
      [AVAILABILITY_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<WorkingHoursSection />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
