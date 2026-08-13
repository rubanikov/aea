import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkingHoursSection } from "./WorkingHoursSection";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const SCHEDULE_PATH = "/scheduling/schedule";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface WindowRow {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/** `GET`/`PUT /scheduling/schedule`'s response shape with sensible
 * defaults; pass `windows` for the live (`current`) generation. */
function scheduleResponse(
  windows: WindowRow[],
  overrides: Partial<{
    timezone: string;
    today: string;
    pending: { effective_from: string; windows: WindowRow[] } | null;
  }> = {}
) {
  return {
    timezone: "America/New_York",
    today: "2026-08-12",
    current: { effective_from: null, windows },
    pending: null,
    ...overrides,
  };
}

/**
 * Routes `fetch` by exact pathname. The schedule API is a single path
 * (`/scheduling/schedule`) for both the mount `GET` and the save `PUT`, so
 * handlers branch on `init.method` where a test cares about both.
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

/** Every PUT call's parsed JSON body, for asserting what was saved. */
function putBodies(fetchMock: ReturnType<typeof mockFetchRouter>): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe("WorkingHoursSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching", () => {
    mockFetchRouter({ [SCHEDULE_PATH]: () => new Promise(() => {}) });
    render(<WorkingHoursSection />);

    expect(screen.getByText(/loading working hours/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when loading fails, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [SCHEDULE_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(scheduleResponse([]));
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
    mockFetchRouter({ [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse([])) });
    render(<WorkingHoursSection />);

    expect(
      await screen.findByText(/you haven't set your working hours yet/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /days available/i })).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(7);
    expect(screen.getByLabelText("Monday")).not.toBeChecked();
  });

  it("reveals a single block defaulting to 09:00-17:00 when a day is checked", async () => {
    mockFetchRouter({ [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse([])) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));

    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday block 1 end time")).toHaveValue("17:00");
  });

  it("renders the live generation's multi-block hours (times with seconds) pre-filled and checked, with the empty-state banner hidden", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        // Monday=0, Friday=4, matching backend/scheduling/models.py's
        // `Availability.DayOfWeek` (Python's date.weekday()).
        jsonResponse(
          scheduleResponse([
            { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
            { id: 2, day_of_week: 0, start_time: "14:00:00", end_time: "17:00:00" },
            { id: 3, day_of_week: 4, start_time: "09:00:00", end_time: "13:00:00" },
          ])
        ),
    });
    render(<WorkingHoursSection />);

    expect(await screen.findByLabelText("Monday")).toBeChecked();
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday block 1 end time")).toHaveValue("12:00");
    expect(screen.getByLabelText("Monday block 2 start time")).toHaveValue("14:00");
    expect(screen.getByLabelText("Monday block 2 end time")).toHaveValue("17:00");
    expect(screen.getByLabelText("Friday block 1 end time")).toHaveValue("13:00");
    expect(screen.getByLabelText("Tuesday")).not.toBeChecked();
    expect(
      screen.queryByText(/you haven't set your working hours yet/i)
    ).not.toBeInTheDocument();
  });

  it("form always shows the live hours, never the pending generation's", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse(
            [{ id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" }],
            {
              pending: {
                effective_from: "2026-08-25",
                windows: [
                  { id: 9, day_of_week: 0, start_time: "10:00:00", end_time: "12:00:00" },
                ],
              },
            }
          )
        ),
    });
    render(<WorkingHoursSection />);

    expect(await screen.findByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday block 1 end time")).toHaveValue("17:00");
    expect(screen.queryByLabelText("Monday block 2 start time")).not.toBeInTheDocument();
  });

  it("'+ Add block' appends a block defaulting to one hour after the previous block's end", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse([
            { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
          ])
        ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByRole("button", { name: /add block to monday/i }));

    expect(screen.getByLabelText("Monday block 2 start time")).toHaveValue("13:00");
    expect(screen.getByLabelText("Monday block 2 end time")).toHaveValue("14:00");
  });

  it("'✕ Remove' removes one block; removing the last block unchecks the day", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse([
            { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
            { id: 2, day_of_week: 0, start_time: "14:00:00", end_time: "17:00:00" },
          ])
        ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /remove monday block 2/i })
    );

    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.queryByLabelText("Monday block 2 start time")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove monday block 1/i }));

    expect(screen.getByLabelText("Monday")).not.toBeChecked();
    // Monday now reads "Unavailable" like every other unchecked day.
    expect(screen.getAllByText("Unavailable")).toHaveLength(7);
    expect(screen.queryByLabelText("Monday block 1 start time")).not.toBeInTheDocument();
  });

  it("removing a middle block keeps the neighbouring blocks' values intact", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse([
            { id: 1, day_of_week: 0, start_time: "08:00:00", end_time: "11:00:00" },
            { id: 2, day_of_week: 0, start_time: "12:30:00", end_time: "15:00:00" },
            { id: 3, day_of_week: 0, start_time: "16:00:00", end_time: "19:00:00" },
          ])
        ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /remove monday block 2/i })
    );

    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("08:00");
    expect(screen.getByLabelText("Monday block 2 start time")).toHaveValue("16:00");
    expect(screen.getByLabelText("Monday block 2 end time")).toHaveValue("19:00");
  });

  it("rejects an end time before the start time with a day-specific inline error, and does not save", async () => {
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse([])),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    fireEvent.change(screen.getByLabelText("Monday block 1 start time"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Monday block 1 end time"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(screen.getByText("End time must be after start time.")).toBeInTheDocument();
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveFocus();
    expect(putBodies(fetchMock)).toHaveLength(0);
  });

  it("rejects blocks less than one hour apart with the interpolated gap message, and does not save", async () => {
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse([
            { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
          ])
        ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByRole("button", { name: /add block to monday/i }));
    fireEvent.change(screen.getByLabelText("Monday block 2 start time"), {
      target: { value: "12:30" },
    });
    fireEvent.change(screen.getByLabelText("Monday block 2 end time"), {
      target: { value: "17:00" },
    });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(
      screen.getByText(
        "Blocks must be at least 1 hour apart. There are only 30 minutes between 12:00 and 12:30."
      )
    ).toBeInTheDocument();
    expect(putBodies(fetchMock)).toHaveLength(0);
  });

  it("clears a day's error once one of its blocks is edited again", async () => {
    mockFetchRouter({ [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse([])) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    fireEvent.change(screen.getByLabelText("Monday block 1 start time"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByLabelText("Monday block 1 end time"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));
    expect(screen.getByText("End time must be after start time.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Monday block 1 end time"), {
      target: { value: "18:00" },
    });

    expect(
      screen.queryByText("End time must be after start time.")
    ).not.toBeInTheDocument();
  });

  it("saves via a single PUT with effective_from null, blocks in start-time order, and shows success feedback from the response", async () => {
    let saved: WindowRow[] = [];
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: (init) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(scheduleResponse(saved));
        }
        const body = JSON.parse(init!.body as string) as {
          windows: Array<Omit<WindowRow, "id">>;
        };
        saved = body.windows.map((window, index) => ({ id: index + 1, ...window }));
        return jsonResponse(scheduleResponse(saved));
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(await screen.findByLabelText("Monday"));
    await user.click(screen.getByRole("button", { name: /add block to monday/i }));
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/working hours saved/i);
    expect(putBodies(fetchMock)).toEqual([
      {
        windows: [
          { day_of_week: 0, start_time: "09:00", end_time: "17:00" },
          { day_of_week: 0, start_time: "18:00", end_time: "19:00" },
        ],
        effective_from: null,
      },
    ]);
    expect(
      screen.queryByText(/you haven't set your working hours yet/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("maps a 400's weekday-keyed windows errors to per-day inline alerts and focuses the first invalid input", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: (init) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(
            scheduleResponse([
              { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
              { id: 2, day_of_week: 0, start_time: "14:00:00", end_time: "17:00:00" },
              { id: 3, day_of_week: 4, start_time: "09:00:00", end_time: "13:00:00" },
            ])
          );
        }
        return jsonResponse(
          {
            windows: {
              "0": ["Blocks on the same day can't overlap."],
              "4": ["Blocks on the same day must be at least 1 hour apart."],
            },
          },
          400
        );
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const mondayEnd = await screen.findByLabelText("Monday block 1 end time");
    fireEvent.change(mondayEnd, { target: { value: "13:00" } });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "Blocks on the same day can't overlap.",
      "Blocks on the same day must be at least 1 hour apart.",
    ]);
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("redirects to /login with a session-expired message on a 401 while loading", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<WorkingHoursSection />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("focuses Monday's checkbox when the empty-state CTA is clicked", async () => {
    mockFetchRouter({ [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse([])) });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /set up working hours/i })
    );

    expect(screen.getByLabelText("Monday")).toHaveFocus();
  });

  // A 409 from PUT means the change would strand these bookings; nothing
  // was written.
  const SAMPLE_COLLISIONS = [
    {
      id: 501,
      start_time: "2026-08-21T18:00:00.000Z",
      end_time: "2026-08-21T18:30:00.000Z",
      patient_name: "J. Alvarez",
      appointment_type_name: "Follow-up",
      status: "confirmed",
    },
    {
      id: 502,
      start_time: "2026-08-21T19:00:00.000Z",
      end_time: "2026-08-21T19:30:00.000Z",
      patient_name: "M. Chen",
      appointment_type_name: "Annual Physical",
      status: "confirmed",
    },
  ];

  const INITIAL_WINDOWS: WindowRow[] = [
    { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" },
    { id: 2, day_of_week: 4, start_time: "09:00:00", end_time: "17:00:00" },
  ];

  it("opens the collision-warning modal with the deferral option on a 409 with earliest_safe_date, listing the affected appointments", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: (init) =>
        (init?.method ?? "GET") === "GET"
          ? jsonResponse(scheduleResponse(INITIAL_WINDOWS))
          : jsonResponse(
              { collisions: SAMPLE_COLLISIONS, earliest_safe_date: "2026-08-25" },
              409
            ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const fridayEnd = await screen.findByLabelText("Friday block 1 end time");
    fireEvent.change(fridayEnd, { target: { value: "13:00" } });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    const dialog = await screen.findByRole("alertdialog", {
      name: /this change affects existing bookings/i,
    });
    expect(dialog).toHaveTextContent(
      "You're changing Friday's hours from 09:00–17:00 to 09:00–13:00."
    );
    expect(screen.getAllByText("CONFIRMED")).toHaveLength(2);
    expect(
      screen.getByText("Fri, Aug 21, 2:00–2:30pm — Patient: J. Alvarez (Follow-up)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fri, Aug 21, 3:00–3:30pm — Patient: M. Chen (Annual Physical)")
    ).toBeInTheDocument();

    const dateInput = screen.getByLabelText("Start date");
    expect(dateInput).toHaveValue("2026-08-25");
    expect(dateInput).toHaveAttribute("min", "2026-08-25");
    expect(
      screen.getByRole("button", { name: "Apply from Aug 25" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("'Apply from' re-PUTs the same windows with the chosen effective_from, closes the modal, and confirms", async () => {
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: (init) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(scheduleResponse(INITIAL_WINDOWS));
        }
        const body = JSON.parse(init!.body as string) as {
          effective_from: string | null;
        };
        if (body.effective_from === null) {
          return jsonResponse(
            { collisions: SAMPLE_COLLISIONS, earliest_safe_date: "2026-08-25" },
            409
          );
        }
        // Deferred write: live hours unchanged, pending generation created.
        return jsonResponse(
          scheduleResponse(INITIAL_WINDOWS, {
            pending: {
              effective_from: body.effective_from,
              windows: [
                { id: 9, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" },
                { id: 10, day_of_week: 4, start_time: "09:00:00", end_time: "13:00:00" },
              ],
            },
          })
        );
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const fridayEnd = await screen.findByLabelText("Friday block 1 end time");
    fireEvent.change(fridayEnd, { target: { value: "13:00" } });
    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    await screen.findByRole("alertdialog");
    // A later date than the earliest safe one is allowed.
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-08-31" },
    });
    await user.click(screen.getByRole("button", { name: "Apply from Aug 31" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "New working hours scheduled to take effect Aug 31, 2026."
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // The form snaps back to the live hours, which the deferred PUT didn't
    // change.
    expect(screen.getByLabelText("Friday block 1 end time")).toHaveValue("17:00");

    // First PUT was the immediate save (409); the second carries the
    // chosen date with the exact same windows.
    expect(putBodies(fetchMock).at(-1)).toEqual({
      windows: [
        { day_of_week: 0, start_time: "09:00", end_time: "17:00" },
        { day_of_week: 4, start_time: "09:00", end_time: "13:00" },
      ],
      effective_from: "2026-08-31",
    });
  });

  it("renders the cancel-only modal when earliest_safe_date is null, and cancelling reverts the form", async () => {
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: (init) =>
        (init?.method ?? "GET") === "GET"
          ? jsonResponse(scheduleResponse(INITIAL_WINDOWS))
          : jsonResponse(
              { collisions: SAMPLE_COLLISIONS, earliest_safe_date: null },
              409
            ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const fridayEnd = await screen.findByLabelText("Friday block 1 end time");
    fireEvent.change(fridayEnd, { target: { value: "13:00" } });
    const saveButton = screen.getByRole("button", { name: /save working hours/i });
    await user.click(saveButton);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/can't be applied from a later date/i);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel this change" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Friday block 1 end time")).toHaveValue("17:00");
    expect(saveButton).toHaveFocus();
    // Only the one rejected PUT — cancelling writes nothing.
    expect(putBodies(fetchMock)).toHaveLength(1);
  });

  it("'Go back' in the deferral modal discards the edit and returns focus to the Save button", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: (init) =>
        (init?.method ?? "GET") === "GET"
          ? jsonResponse(scheduleResponse(INITIAL_WINDOWS))
          : jsonResponse(
              { collisions: SAMPLE_COLLISIONS, earliest_safe_date: "2026-08-25" },
              409
            ),
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    const fridayEnd = await screen.findByLabelText("Friday block 1 end time");
    fireEvent.change(fridayEnd, { target: { value: "13:00" } });
    const saveButton = screen.getByRole("button", { name: /save working hours/i });
    await user.click(saveButton);

    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Friday block 1 end time")).toHaveValue("17:00");
    expect(saveButton).toHaveFocus();
  });

  const PENDING_PATH = "/scheduling/schedule/pending";

  // Pending: Monday shrinks to 10:00–12:00 (currently 09:00–17:00 live).
  const PENDING_GENERATION = {
    effective_from: "2026-08-25",
    windows: [
      { id: 9, day_of_week: 0, start_time: "10:00:00", end_time: "12:00:00" },
    ],
  };

  it("shows the pending-change banner when the schedule has a pending generation, and hides it otherwise", async () => {
    mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse(INITIAL_WINDOWS, { pending: PENDING_GENERATION })
        ),
    });
    render(<WorkingHoursSection />);

    expect(
      await screen.findByRole("region", { name: /pending schedule change/i })
    ).toHaveTextContent(
      "Scheduled change: new hours take effect Tuesday, August 25, 2026"
    );

    // Re-render without a pending generation: no banner.
    cleanup();
    vi.unstubAllGlobals();
    mockFetchRouter({
      [SCHEDULE_PATH]: () => jsonResponse(scheduleResponse(INITIAL_WINDOWS)),
    });
    render(<WorkingHoursSection />);

    await screen.findByLabelText("Monday block 1 start time");
    expect(
      screen.queryByRole("region", { name: /pending schedule change/i })
    ).not.toBeInTheDocument();
  });

  it("'Edit pending change' hydrates the form with the pending hours, and saving PUTs with the pending effective_from", async () => {
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: (init) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(
            scheduleResponse(INITIAL_WINDOWS, { pending: PENDING_GENERATION })
          );
        }
        const body = JSON.parse(init!.body as string) as {
          windows: Array<Omit<WindowRow, "id">>;
          effective_from: string | null;
        };
        return jsonResponse(
          scheduleResponse(INITIAL_WINDOWS, {
            pending: {
              effective_from: body.effective_from!,
              windows: body.windows.map((window, index) => ({
                id: index + 20,
                ...window,
              })),
            },
          })
        );
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /edit pending change/i })
    );

    // The form now holds the pending generation, not the live hours.
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("10:00");
    expect(screen.getByLabelText("Monday block 1 end time")).toHaveValue("12:00");
    expect(screen.getByLabelText("Friday")).not.toBeChecked();
    expect(screen.getByLabelText("Monday")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/editing pending change/i);

    await user.click(screen.getByRole("button", { name: /save working hours/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "New working hours scheduled to take effect Aug 25, 2026."
    );
    expect(putBodies(fetchMock)).toEqual([
      {
        windows: [{ day_of_week: 0, start_time: "10:00", end_time: "12:00" }],
        effective_from: "2026-08-25",
      },
    ]);
    // After the save the form snaps back to the (unchanged) live hours.
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Friday")).toBeChecked();
  });

  it("cancelling the pending change DELETEs it, drops the banner, and keeps the live hours in the form", async () => {
    let cancelled = false;
    const fetchMock = mockFetchRouter({
      [SCHEDULE_PATH]: () =>
        jsonResponse(
          scheduleResponse(
            INITIAL_WINDOWS,
            cancelled ? {} : { pending: PENDING_GENERATION }
          )
        ),
      [PENDING_PATH]: () => {
        cancelled = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    render(<WorkingHoursSection />);

    await user.click(
      await screen.findByRole("button", { name: /cancel pending change/i })
    );
    await user.click(screen.getByRole("button", { name: /yes, cancel it/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /pending schedule change/i })
      ).not.toBeInTheDocument()
    );
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
      )
    ).toBe(true);
    // Live hours are untouched and the form is still usable.
    expect(screen.getByLabelText("Monday block 1 start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Friday block 1 end time")).toHaveValue("17:00");
    expect(putBodies(fetchMock)).toHaveLength(0);
  });
});
