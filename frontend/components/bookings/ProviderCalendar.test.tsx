import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderCalendar } from "./ProviderCalendar";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROFILE_PATH = "/profile";
const BOOKINGS_PATH = "/bookings";
const TIMEZONE = "America/New_York";

// Exactly the wireframe's (Screen 8) sample day -- Tuesday, August 18,
// 2026 -- in UTC as the API would send it for a provider on
// America/New_York (EDT, UTC-4 in August).
const NEW_PATIENT_VISIT = {
  id: 1,
  patient_id: 101,
  patient_name: "R. Nikov",
  appointment_type_name: "New Patient Visit",
  start_time: "2026-08-18T13:00:00.000Z", // 9:00am ET
  end_time: "2026-08-18T13:45:00.000Z", // 9:45am ET
  status: "confirmed",
};

const FOLLOW_UP = {
  id: 2,
  patient_id: 102,
  patient_name: "S. Patel",
  appointment_type_name: "Follow-up",
  start_time: "2026-08-18T14:00:00.000Z", // 10:00am ET
  end_time: "2026-08-18T14:15:00.000Z", // 10:15am ET
  status: "confirmed",
};

const LAB_REVIEW = {
  id: 3,
  patient_id: 103,
  patient_name: "T. Kim",
  appointment_type_name: "Lab Review",
  start_time: "2026-08-18T17:00:00.000Z", // 1:00pm ET
  end_time: "2026-08-18T17:10:00.000Z", // 1:10pm ET
  status: "completed",
};

// Not in the wireframe -- added so a still-`confirmed`, not-yet-started
// booking exists to exercise "Mark no-show" disabled state.
const AFTERNOON_CHECKUP = {
  id: 4,
  patient_id: 104,
  patient_name: "J. Alvarez",
  appointment_type_name: "Checkup",
  start_time: "2026-08-18T19:00:00.000Z", // 3:00pm ET
  end_time: "2026-08-18T19:30:00.000Z", // 3:30pm ET
  status: "confirmed",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes `fetch` by pathname (query strings are ignored, matching every
 * other section's test router in this codebase) -- `/profile` defaults to
 * a successful America/New_York response unless a test overrides it. */
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
    if (path === PROFILE_PATH) {
      return Promise.resolve(jsonResponse({ timezone: TIMEZONE }));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ProviderCalendar", () => {
  beforeEach(() => {
    // Freezes only `Date`/`Date.now()` (not setTimeout/setInterval), so
    // `userEvent`/`waitFor`/`findBy*` all keep working on real timers
    // exactly as in every other test in this codebase -- "now" is 11:00am
    // ET on Tuesday, August 18, 2026: after New Patient Visit's and
    // Follow-up's start times, before Lab Review's and the Checkup's --
    // the split "Mark no-show" disabled-until-start-passed depends on.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-18T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while the provider's timezone loads", () => {
    mockFetchRouter({ [PROFILE_PATH]: () => new Promise(() => {}) });
    render(<ProviderCalendar />);

    expect(screen.getByText(/loading your calendar/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when the timezone fails to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [PROFILE_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse({ timezone: TIMEZONE });
      },
      [BOOKINGS_PATH]: () => jsonResponse([]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your calendar/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("No appointments this week.")).toBeInTheDocument();
  });

  it("shows a loading state for appointments once the timezone is known", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => new Promise(() => {}) });
    render(<ProviderCalendar />);

    expect(await screen.findByText(/loading your appointments/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when appointments fail to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [BOOKINGS_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse([NEW_PATIENT_VISIT]);
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your appointments/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("New Patient Visit — R. Nikov")).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<ProviderCalendar />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a clean empty state, not a blank page, when there are no appointments this week", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([]) });
    render(<ProviderCalendar />);

    expect(await screen.findByText("No appointments this week.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Tuesday, August 18, 2026, 0 appointments",
      })
    ).toBeInTheDocument();
  });

  it("defaults to today, groups the day's appointments under a real heading, shows status as icon+text, and never shows a confirm/decline action", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: () =>
        jsonResponse([NEW_PATIENT_VISIT, FOLLOW_UP, LAB_REVIEW, AFTERNOON_CHECKUP]),
    });
    render(<ProviderCalendar />);

    expect(
      await screen.findByRole("heading", { name: "Tuesday, August 18, 2026", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Tuesday, August 18, 2026, 4 appointments",
      })
    ).toBeInTheDocument();

    // Confirmed rows: time range, icon+text status badge, type + patient.
    expect(screen.getByText("9:00–9:45am")).toBeInTheDocument();
    expect(screen.getByText("New Patient Visit — R. Nikov")).toBeInTheDocument();
    expect(screen.getAllByText("CONFIRMED")).toHaveLength(3);

    // Completed row: no "(closed)" actions, no status-change buttons.
    expect(screen.getByText("1:00–1:10pm")).toBeInTheDocument();
    expect(screen.getByText("Lab Review — T. Kim (closed)")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lab Review/ })
    ).not.toBeInTheDocument();

    // Role-appropriate actions on a confirmed row -- and never a
    // confirm/decline action anywhere on this screen.
    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    expect(
      screen.getByRole("button", { name: `Mark completed: ${context}` })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Mark no-show: ${context}` })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Cancel: ${context}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
  });

  it("keeps 'Mark no-show' disabled with a visible reason until the appointment's start time has passed", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([AFTERNOON_CHECKUP]) });
    render(<ProviderCalendar />);

    const context = "Checkup with J. Alvarez, 3:00–3:30pm";
    const noShowButton = await screen.findByRole("button", {
      name: `Mark no-show: ${context}`,
    });
    expect(noShowButton).toBeDisabled();
    expect(
      screen.getByText("Available once the appointment's start time has passed.")
    ).toBeInTheDocument();
  });

  it("enables 'Mark no-show' once the appointment's start time has passed", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]) });
    render(<ProviderCalendar />);

    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    expect(
      await screen.findByRole("button", { name: `Mark no-show: ${context}` })
    ).toBeEnabled();
  });

  it("filters the agenda list to whichever day is selected in the week strip", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]) });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await screen.findByRole("heading", { name: "Tuesday, August 18, 2026" });
    expect(screen.getByText("New Patient Visit — R. Nikov")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Wednesday, August 19, 2026, 0 appointments" })
    );

    expect(
      await screen.findByRole("heading", { name: "Wednesday, August 19, 2026" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("No appointments on Wednesday, August 19, 2026.")
    ).toBeInTheDocument();
    expect(screen.queryByText("New Patient Visit — R. Nikov")).not.toBeInTheDocument();
  });

  it("navigates prev/next week (re-fetching for the new range) and Today (back to the current week)", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await screen.findByText("Week of Aug 17–23, 2026");

    await user.click(screen.getByRole("button", { name: "Go to previous week" }));

    expect(await screen.findByText("Week of Aug 10–16, 2026")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Monday, August 10, 2026" })
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes("date_from=2026-08-10&date_to=2026-08-16")
      )
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Today" }));

    expect(await screen.findByText("Week of Aug 17–23, 2026")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Tuesday, August 18, 2026" })
    ).toBeInTheDocument();
  });

  it("marks a booking completed: PATCHes /bookings/:id/status and the badge updates without a full reload", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([NEW_PATIENT_VISIT]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/status": (init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ ...NEW_PATIENT_VISIT, status: body.status });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    await user.click(
      await screen.findByRole("button", { name: `Mark completed: ${context}` })
    );

    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Mark completed: ${context}` })
    ).not.toBeInTheDocument();

    const patchCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/1/status")
    );
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({
      status: "completed",
    });
  });

  it("keeps the patient name and appointment type visible after a status change, even when the server's response omits them (Booking's canonical shape, not the list shape)", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([NEW_PATIENT_VISIT]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/status": (init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          // The real PATCH /bookings/:id/status response is Booking's
          // canonical serializer -- {id, provider_id, patient_id,
          // appointment_type_id, start_time, end_time, status} -- it never
          // includes patient_name/appointment_type_name. Deliberately
          // narrow here (unlike the other status-change tests above, which
          // still echo the full fixture) to prove the component doesn't
          // depend on the response carrying those display fields.
          return jsonResponse({
            id: NEW_PATIENT_VISIT.id,
            provider_id: 5,
            patient_id: NEW_PATIENT_VISIT.patient_id,
            appointment_type_id: 12,
            start_time: NEW_PATIENT_VISIT.start_time,
            end_time: NEW_PATIENT_VISIT.end_time,
            status: body.status,
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    await user.click(
      await screen.findByRole("button", { name: `Mark completed: ${context}` })
    );

    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText(/R\. Nikov/)).toBeInTheDocument();
    expect(screen.getByText(/New Patient Visit/)).toBeInTheDocument();
  });

  it("cancels a booking: the row loses its status-action buttons once cancelled", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([FOLLOW_UP]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/2/status": (init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ ...FOLLOW_UP, status: body.status });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    const context = "Follow-up with S. Patel, 10:00–10:15am";
    await user.click(await screen.findByRole("button", { name: `Cancel: ${context}` }));

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Cancel: ${context}` })
    ).not.toBeInTheDocument();
  });

  it("shows the server's specific error message inline when a status update is rejected as an invalid transition", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([NEW_PATIENT_VISIT]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/status": () =>
        jsonResponse(
          { detail: "Can't mark no-show before the appointment start time." },
          400
        ),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    await user.click(
      await screen.findByRole("button", { name: `Mark no-show: ${context}` })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't mark no-show before the appointment start time."
    );
    // The row's own status is unchanged -- a rejected transition never
    // silently updates the UI.
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
  });

  it("falls back to a generic message when a status update fails without a specific server error", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([NEW_PATIENT_VISIT]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/status": () => new Response("", { status: 500 }),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    const context = "New Patient Visit with R. Nikov, 9:00–9:45am";
    await user.click(
      await screen.findByRole("button", { name: `Cancel: ${context}` })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't update this appointment/i
    );
  });
});
