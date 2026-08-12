import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderCalendar } from "./ProviderCalendar";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROFILE_PATH = "/profile";
const BOOKINGS_PATH = "/bookings";
const AVAILABILITY_PATH = "/scheduling/availability";
const BLOCKED_TIME_PATH = "/scheduling/blocked-time";
const TIMEZONE = "America/New_York";

// Mon–Fri 9–17, the provider's recurring weekly schedule as
// `GET /scheduling/availability` returns it.
const DEFAULT_AVAILABILITY = [0, 1, 2, 3, 4].map((day) => ({
  id: day + 1,
  day_of_week: day,
  start_time: "09:00:00",
  end_time: "17:00:00",
}));

// Tuesday, August 18, 2026, in UTC as the API would send it for a
// provider on America/New_York (EDT, UTC-4 in August).
const NEW_PATIENT_VISIT = {
  id: 1,
  patient_id: 101,
  patient_name: "R. Nikov",
  appointment_type_name: "New Patient Visit",
  start_time: "2026-08-18T13:00:00.000Z", // 9:00am ET
  end_time: "2026-08-18T13:45:00.000Z", // 9:45am ET
  status: "confirmed",
  cancellation_reason: "",
};

const FOLLOW_UP = {
  id: 2,
  patient_id: 102,
  patient_name: "S. Patel",
  appointment_type_name: "Follow-up",
  start_time: "2026-08-18T14:00:00.000Z", // 10:00am ET
  end_time: "2026-08-18T14:15:00.000Z", // 10:15am ET
  status: "confirmed",
  cancellation_reason: "",
};

const LAB_REVIEW = {
  id: 3,
  patient_id: 103,
  patient_name: "T. Kim",
  appointment_type_name: "Lab Review",
  start_time: "2026-08-18T17:00:00.000Z", // 1:00pm ET
  end_time: "2026-08-18T17:10:00.000Z", // 1:10pm ET
  status: "completed",
  cancellation_reason: "",
};

// A still-`confirmed`, not-yet-started booking, to exercise the
// "Mark no-show" disabled state.
const AFTERNOON_CHECKUP = {
  id: 4,
  patient_id: 104,
  patient_name: "J. Alvarez",
  appointment_type_name: "Checkup",
  start_time: "2026-08-18T19:00:00.000Z", // 3:00pm ET
  end_time: "2026-08-18T19:30:00.000Z", // 3:30pm ET
  status: "confirmed",
  cancellation_reason: "",
};

// Grid block accessible names: "type with patient, range, STATUS".
const NEW_PATIENT_BLOCK = "New Patient Visit with R. Nikov, 9:00–9:45am, CONFIRMED";
const FOLLOW_UP_BLOCK = "Follow-up with S. Patel, 10:00–10:15am, CONFIRMED";
// Popover action names, matching the agenda fallback's convention.
const NEW_PATIENT_CONTEXT = "New Patient Visit with R. Nikov, 9:00–9:45am";
const FOLLOW_UP_CONTEXT = "Follow-up with S. Patel, 10:00–10:15am";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes `fetch` by pathname (query strings are ignored, matching every
 * other section's test router in this codebase). `/profile` defaults to a
 * successful America/New_York response, `/scheduling/availability` to the
 * Mon–Fri 9–17 schedule, and `/scheduling/blocked-time` to an empty list
 * unless a test overrides them. */
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
    if (path === AVAILABILITY_PATH) {
      return Promise.resolve(jsonResponse(DEFAULT_AVAILABILITY));
    }
    if (path === BLOCKED_TIME_PATH) {
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof mockFetchRouter>, path: string): number {
  return fetchMock.mock.calls.filter(([url]) => new URL(url as string).pathname === path)
    .length;
}

/** Opens the detail popover for a grid block by its accessible name. */
async function openBlock(user: ReturnType<typeof userEvent.setup>, blockName: string) {
  await user.click(await screen.findByRole("button", { name: blockName }));
}

describe("ProviderCalendar", () => {
  beforeEach(() => {
    // Freezes only `Date`/`Date.now()` (not setTimeout/setInterval), so
    // `userEvent`/`waitFor`/`findBy*` all keep working on real timers,
    // exactly as in every other test in this codebase. "now" is 11:00am
    // ET on Tuesday, August 18, 2026: after New Patient Visit's and
    // Follow-up's start times, before Lab Review's and the Checkup's,
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

    expect(
      await screen.findByRole("button", { name: NEW_PATIENT_BLOCK })
    ).toBeInTheDocument();
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

  it("renders the week as a time grid: day headers with today marked, hour ruler, and blocks positioned per booking", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: () =>
        jsonResponse([NEW_PATIENT_VISIT, FOLLOW_UP, LAB_REVIEW, AFTERNOON_CHECKUP]),
    });
    render(<ProviderCalendar />);

    // One block per booking, status carried in the accessible name.
    expect(
      await screen.findByRole("button", { name: NEW_PATIENT_BLOCK })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: FOLLOW_UP_BLOCK })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lab Review with T. Kim, 1:00–1:10pm, COMPLETED" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Checkup with J. Alvarez, 3:00–3:30pm, CONFIRMED" })
    ).toBeInTheDocument();

    // Day headers Mon–Sun, with today (Tue Aug 18) marked.
    expect(screen.getByText("Mon 17")).toBeInTheDocument();
    expect(screen.getByText("Sun 23")).toBeInTheDocument();
    // (The mini month marks today too, so scope to the header cell.)
    expect(screen.getByText("Tue 18").closest('[aria-current="date"]')).not.toBeNull();

    // Hour ruler spans the configured 9–17 hours.
    expect(screen.getByText("9 AM")).toBeInTheDocument();
    expect(screen.getByText("4 PM")).toBeInTheDocument();
    expect(screen.queryByText("7 AM")).not.toBeInTheDocument();

    // Week range label in the toolbar.
    expect(screen.getByText("Week of Aug 17–23, 2026")).toBeInTheDocument();
  });

  it("opens a detail popover with the role-appropriate actions, and never a confirm/decline action", async () => {
    mockFetchRouter({
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT, LAB_REVIEW]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, NEW_PATIENT_BLOCK);

    expect(
      screen.getByRole("button", { name: `Mark completed: ${NEW_PATIENT_CONTEXT}` })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Mark no-show: ${NEW_PATIENT_CONTEXT}` })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Cancel: ${NEW_PATIENT_CONTEXT}` })
    ).toBeInTheDocument();
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirm booking/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
  });

  it("shows no status actions in the popover for a closed (completed) booking", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([LAB_REVIEW]) });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, "Lab Review with T. Kim, 1:00–1:10pm, COMPLETED");

    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark completed:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cancel:/ })).not.toBeInTheDocument();
  });

  it("keeps 'Mark no-show' disabled with a visible reason until the appointment's start time has passed", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([AFTERNOON_CHECKUP]) });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, "Checkup with J. Alvarez, 3:00–3:30pm, CONFIRMED");

    const noShowButton = screen.getByRole("button", {
      name: "Mark no-show: Checkup with J. Alvarez, 3:00–3:30pm",
    });
    expect(noShowButton).toBeDisabled();
    expect(
      screen.getByText("Available once the appointment's start time has passed.")
    ).toBeInTheDocument();
  });

  it("enables 'Mark no-show' once the appointment's start time has passed", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]) });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, NEW_PATIENT_BLOCK);

    expect(
      screen.getByRole("button", { name: `Mark no-show: ${NEW_PATIENT_CONTEXT}` })
    ).toBeEnabled();
  });

  it("navigates prev/next week (re-fetching bookings for the new range) and Today, WITHOUT re-fetching availability", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await screen.findByText("Week of Aug 17–23, 2026");
    expect(callsTo(fetchMock, AVAILABILITY_PATH)).toBe(1);

    await user.click(screen.getByRole("button", { name: "Go to previous week" }));

    expect(await screen.findByText("Week of Aug 10–16, 2026")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes("date_from=2026-08-10&date_to=2026-08-16")
      )
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByText("Week of Aug 17–23, 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next week" }));
    expect(await screen.findByText("Week of Aug 24–30, 2026")).toBeInTheDocument();

    // The recurring schedule is identical every week: availability was
    // fetched once on mount and never again across three navigations.
    expect(callsTo(fetchMock, AVAILABILITY_PATH)).toBe(1);
    expect(callsTo(fetchMock, PROFILE_PATH)).toBe(1);
  });

  it("jumps the grid to a day's week from the mini month", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await screen.findByText("Week of Aug 17–23, 2026");

    await user.click(screen.getByRole("button", { name: "Wednesday, August 26, 2026" }));

    expect(await screen.findByText("Week of Aug 24–30, 2026")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes("date_from=2026-08-24&date_to=2026-08-30")
      )
    ).toBe(true);
    expect(callsTo(fetchMock, AVAILABILITY_PATH)).toBe(1);
  });

  it("extends the visible hours to include a booking outside configured availability instead of cutting it off", async () => {
    // 11:00Z is 7:00am ET — before the configured 9:00 start.
    const earlyBird = {
      ...NEW_PATIENT_VISIT,
      start_time: "2026-08-18T11:00:00.000Z",
      end_time: "2026-08-18T11:45:00.000Z",
    };
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([earlyBird]) });
    render(<ProviderCalendar />);

    expect(
      await screen.findByRole("button", {
        name: "New Patient Visit with R. Nikov, 7:00–7:45am, CONFIRMED",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("7 AM")).toBeInTheDocument();
  });

  it("renders the grid with gridlines and an empty-week message when there are no appointments", async () => {
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([]) });
    render(<ProviderCalendar />);

    expect(await screen.findByText("No appointments this week.")).toBeInTheDocument();
    // The calendar stays recognizable as a calendar: headers + ruler intact.
    expect(screen.getByText("Mon 17")).toBeInTheDocument();
    expect(screen.getByText("9 AM")).toBeInTheDocument();
  });

  it("shows a setup prompt instead of an empty grid when there is no availability AND no bookings", async () => {
    mockFetchRouter({
      [AVAILABILITY_PATH]: () => jsonResponse([]),
      [BOOKINGS_PATH]: () => jsonResponse([]),
    });
    render(<ProviderCalendar />);

    expect(await screen.findByText("No working hours set up yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your calendar shows the hours you're available. Set your weekly working hours to see them here."
      )
    ).toBeInTheDocument();
    const setupLink = screen.getByRole("link", { name: "Set working hours" });
    expect(setupLink).toHaveAttribute("href", "/provider");
    // No grid pretending to be a calendar behind it.
    expect(screen.queryByText("No appointments this week.")).not.toBeInTheDocument();
    expect(screen.queryByText("Mon 17")).not.toBeInTheDocument();
  });

  it("still renders the grid (bounded by the bookings) with an inline nudge when availability is empty but bookings exist", async () => {
    mockFetchRouter({
      [AVAILABILITY_PATH]: () => jsonResponse([]),
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
    });
    render(<ProviderCalendar />);

    expect(
      await screen.findByRole("button", { name: NEW_PATIENT_BLOCK })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No working hours configured — showing booked times only\./)
    ).toBeInTheDocument();
    // A nudge, not the blocking setup card.
    expect(screen.queryByText("No working hours set up yet")).not.toBeInTheDocument();
  });

  it("keeps the grid rendering when the availability fetch fails, with a scoped retry that re-fires only that fetch", async () => {
    let availabilityCalls = 0;
    const fetchMock = mockFetchRouter({
      [AVAILABILITY_PATH]: () => {
        availabilityCalls += 1;
        return availabilityCalls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(DEFAULT_AVAILABILITY);
      },
      [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    // Non-blocking: the grid (bounded by the booking) renders alongside
    // the warning, which is a status, not an alert.
    expect(
      await screen.findByRole("button", { name: NEW_PATIENT_BLOCK })
    ).toBeInTheDocument();
    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent(/couldn't load your working hours/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const profileCallsBefore = callsTo(fetchMock, PROFILE_PATH);
    const bookingsCallsBefore = callsTo(fetchMock, BOOKINGS_PATH);

    await user.click(within(warning).getByRole("button", { name: "Try again" }));

    // The retried schedule arrives and reshapes the grid (9 AM start).
    expect(await screen.findByText("9 AM")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // Scoped: only the availability fetch re-fired.
    expect(callsTo(fetchMock, AVAILABILITY_PATH)).toBe(2);
    expect(callsTo(fetchMock, PROFILE_PATH)).toBe(profileCallsBefore);
    expect(callsTo(fetchMock, BOOKINGS_PATH)).toBe(bookingsCallsBefore);
  });

  it("marks a booking completed from the popover: PATCHes /bookings/:id/status and the block updates without a full reload", async () => {
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

    await openBlock(user, NEW_PATIENT_BLOCK);
    await user.click(
      screen.getByRole("button", { name: `Mark completed: ${NEW_PATIENT_CONTEXT}` })
    );

    expect(
      await screen.findByRole("button", {
        name: "New Patient Visit with R. Nikov, 9:00–9:45am, COMPLETED",
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Mark completed: ${NEW_PATIENT_CONTEXT}` })
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

    await openBlock(user, NEW_PATIENT_BLOCK);
    await user.click(
      screen.getByRole("button", { name: `Mark completed: ${NEW_PATIENT_CONTEXT}` })
    );

    // The block's display fields survive the partial merge.
    expect(
      await screen.findByRole("button", {
        name: "New Patient Visit with R. Nikov, 9:00–9:45am, COMPLETED",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("cancels a booking through the popover's reason step: PATCHes cancellation_reason and the block loses its actions once cancelled", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([FOLLOW_UP]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/2/status": (init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({
            ...FOLLOW_UP,
            status: body.status,
            cancellation_reason: body.cancellation_reason,
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, FOLLOW_UP_BLOCK);
    await user.click(
      screen.getByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` })
    );

    // Two-step: nothing is PATCHed until the reason is confirmed.
    const textarea = screen.getByLabelText("Reason for cancelling");
    expect(textarea).toHaveAttribute("maxlength", "500");
    const confirmButton = screen.getByRole("button", { name: "Confirm cancel" });
    expect(confirmButton).toBeDisabled();

    await user.type(textarea, "Provider is out sick today");
    await user.click(confirmButton);

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` })
    ).not.toBeInTheDocument();
    // The popover now shows the written reason on the cancelled booking.
    expect(screen.getByText("Reason: Provider is out sick today")).toBeInTheDocument();

    const patchCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/2/status")
    );
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({
      status: "cancelled",
      cancellation_reason: "Provider is out sick today",
    });
  });

  it("warns (role=status, not alert) when the cancel succeeds but the cancellation email didn't reach the patient, without hiding the cancelled block", async () => {
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
          return jsonResponse({
            ...FOLLOW_UP,
            status: body.status,
            cancellation_reason: body.cancellation_reason,
            notification: {
              email_sent: false,
              email_failed: true,
              sms_attempted: false,
              sms_sent: false,
              sms_skipped_reason: "no_phone",
            },
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, FOLLOW_UP_BLOCK);
    await user.click(screen.getByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent(
      "Appointment cancelled, but we couldn't reach the patient by email. Please call them."
    );
    // Informational, not an error: the cancellation itself succeeded. And
    // the SMS skip (no phone on file) is expected — one warning only.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });

  it("warns separately about an attempted-and-failed text message, alongside the email warning", async () => {
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
          return jsonResponse({
            ...FOLLOW_UP,
            status: body.status,
            cancellation_reason: body.cancellation_reason,
            notification: {
              email_sent: false,
              email_failed: true,
              sms_attempted: true,
              sms_sent: false,
              sms_skipped_reason: "send_failed",
            },
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, FOLLOW_UP_BLOCK);
    await user.click(screen.getByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    const warnings = await screen.findAllByRole("status");
    expect(warnings).toHaveLength(2);
    expect(
      screen.getByText(
        "Appointment cancelled, but we couldn't reach the patient by email. Please call them."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Appointment cancelled, but we couldn't send the text message. Please call the patient."
      )
    ).toBeInTheDocument();
  });

  it("renders no warning when the cancellation email and text were delivered", async () => {
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
          return jsonResponse({
            ...FOLLOW_UP,
            status: body.status,
            cancellation_reason: body.cancellation_reason,
            notification: {
              email_sent: true,
              email_failed: false,
              sms_attempted: true,
              sms_sent: true,
              sms_skipped_reason: null,
            },
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, FOLLOW_UP_BLOCK);
    await user.click(screen.getByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't reach the patient by email/)
    ).not.toBeInTheDocument();
  });

  it("renders no warning (and doesn't crash) when the cancel response has no notification key at all", async () => {
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
          return jsonResponse({
            ...FOLLOW_UP,
            status: body.status,
            cancellation_reason: body.cancellation_reason,
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<ProviderCalendar />);

    await openBlock(user, FOLLOW_UP_BLOCK);
    await user.click(screen.getByRole("button", { name: `Cancel: ${FOLLOW_UP_CONTEXT}` }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

    await openBlock(user, NEW_PATIENT_BLOCK);
    await user.click(
      screen.getByRole("button", { name: `Mark no-show: ${NEW_PATIENT_CONTEXT}` })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't mark no-show before the appointment start time."
    );
    // The booking's own status is unchanged; a rejected transition never
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

    await openBlock(user, NEW_PATIENT_BLOCK);
    await user.click(screen.getByRole("button", { name: `Cancel: ${NEW_PATIENT_CONTEXT}` }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't update this appointment/i
    );
  });

  it("falls back to the week-strip + day-agenda list on narrow screens", async () => {
    // jsdom has no matchMedia; provide one that reports a narrow viewport.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFetchRouter({ [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]) });
    render(<ProviderCalendar />);

    // The agenda fallback: selected-day heading, day buttons with counts,
    // and the row list — no grid blocks.
    expect(
      await screen.findByRole("heading", { name: "Tuesday, August 18, 2026", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tuesday, August 18, 2026, 1 appointment" })
    ).toBeInTheDocument();
    expect(screen.getByText("New Patient Visit — R. Nikov")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: NEW_PATIENT_BLOCK })
    ).not.toBeInTheDocument();
  });

  describe("blocked time", () => {
    // 10:00am–12:00pm ET on Tuesday, August 18 — inside the visible week.
    const LUNCH_HOLD = {
      id: 1,
      label: "Lunch",
      start: "2026-08-18T14:00:00.000Z",
      end: "2026-08-18T16:00:00.000Z",
    };
    // 10:00am–12:00pm ET on Tuesday, August 25 — the FOLLOWING week.
    const NEXT_WEEK_HOLD = {
      id: 2,
      label: "Conference",
      start: "2026-08-25T14:00:00.000Z",
      end: "2026-08-25T16:00:00.000Z",
    };

    it("hatches blocked ranges overlapping the visible week, and renders nothing for a block outside it", async () => {
      mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () => jsonResponse([LUNCH_HOLD, NEXT_WEEK_HOLD]),
      });
      render(<ProviderCalendar />);

      expect(await screen.findByText("Blocked: Lunch, 10:00am–12:00pm")).toBeInTheDocument();
      expect(document.querySelectorAll(".hatch-unavailable")).toHaveLength(1);
      // The next-week hold is filtered out client-side, not painted.
      expect(screen.queryByText(/Conference/)).not.toBeInTheDocument();
    });

    it("names an unlabeled block 'Blocked' without a dangling label", async () => {
      mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () => jsonResponse([{ ...LUNCH_HOLD, label: "" }]),
      });
      render(<ProviderCalendar />);

      expect(await screen.findByText("Blocked, 10:00am–12:00pm")).toBeInTheDocument();
      expect(screen.queryByText(/^Blocked: /)).not.toBeInTheDocument();
    });

    it("announces the CLIPPED range for a block extending past the grid's visible hours, truncated at the grid edge", async () => {
      // 7:00am–10:00am ET against the configured 9–17 grid: only
      // 9:00–10:00 is visible (the booking keeps the range at 9–17).
      mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () =>
          jsonResponse([
            {
              id: 3,
              label: "Early hold",
              start: "2026-08-18T11:00:00.000Z",
              end: "2026-08-18T14:00:00.000Z",
            },
          ]),
      });
      render(<ProviderCalendar />);

      expect(
        await screen.findByText("Blocked: Early hold, 9:00–10:00am")
      ).toBeInTheDocument();
      const hatch = document.querySelector<HTMLElement>(".hatch-unavailable");
      expect(hatch?.style.top).toBe("0%"); // truncated at the top edge, no overflow
    });

    it("renders a multi-day block as a separate clipped region in EACH day column it spans", async () => {
      // Wednesday Aug 19 00:00 ET through Saturday Aug 22 00:00 ET:
      // Wed, Thu, Fri each get their own full-height clipped region.
      mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () =>
          jsonResponse([
            {
              id: 4,
              label: "Vacation",
              start: "2026-08-19T04:00:00.000Z",
              end: "2026-08-22T04:00:00.000Z",
            },
          ]),
      });
      render(<ProviderCalendar />);

      expect(
        await screen.findAllByText("Blocked: Vacation, 9:00am–5:00pm")
      ).toHaveLength(3);
      const hatches = document.querySelectorAll<HTMLElement>(".hatch-unavailable");
      expect(hatches).toHaveLength(3);
      for (const hatch of hatches) {
        expect(hatch.style.top).toBe("0%");
        expect(hatch.style.height).toBe("100%");
      }
    });

    it("fetches blocked time exactly once per mount, re-filtering (not re-fetching) on week navigation", async () => {
      const fetchMock = mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () => jsonResponse([LUNCH_HOLD, NEXT_WEEK_HOLD]),
      });
      const user = userEvent.setup();
      render(<ProviderCalendar />);

      expect(await screen.findByText("Blocked: Lunch, 10:00am–12:00pm")).toBeInTheDocument();
      expect(callsTo(fetchMock, BLOCKED_TIME_PATH)).toBe(1);

      await user.click(screen.getByRole("button", { name: "Go to next week" }));
      await screen.findByText("Week of Aug 24–30, 2026");

      // The following week's hold appears purely from the already-held
      // list; this week's disappears.
      expect(
        await screen.findByText("Blocked: Conference, 10:00am–12:00pm")
      ).toBeInTheDocument();
      expect(screen.queryByText(/Blocked: Lunch/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Today" }));
      await screen.findByText("Week of Aug 17–23, 2026");
      await user.click(screen.getByRole("button", { name: "Go to previous week" }));
      await screen.findByText("Week of Aug 10–16, 2026");
      expect(screen.queryByText(/^Blocked/)).not.toBeInTheDocument();

      expect(callsTo(fetchMock, BLOCKED_TIME_PATH)).toBe(1);
    });

    it("keeps a booking inside a blocked window fully clickable — the hatch never intercepts its popover click", async () => {
      // The hold covers the whole 9–17 day, including New Patient Visit.
      mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () =>
          jsonResponse([
            {
              id: 5,
              label: "Admin day",
              start: "2026-08-18T13:00:00.000Z",
              end: "2026-08-18T21:00:00.000Z",
            },
          ]),
      });
      const user = userEvent.setup();
      render(<ProviderCalendar />);

      await screen.findByText("Blocked: Admin day, 9:00am–5:00pm");
      const hatch = document.querySelector<HTMLElement>(".hatch-unavailable");
      expect(hatch).toHaveAttribute("aria-hidden", "true");
      expect(hatch).toHaveClass("pointer-events-none");

      await openBlock(user, NEW_PATIENT_BLOCK);
      expect(
        screen.getByRole("button", { name: `Mark completed: ${NEW_PATIENT_CONTEXT}` })
      ).toBeInTheDocument();
    });

    it("keeps the grid rendering when the blocked-time fetch fails — no false hatching — with a scoped retry that re-fires only that fetch", async () => {
      let blockedCalls = 0;
      const fetchMock = mockFetchRouter({
        [BOOKINGS_PATH]: () => jsonResponse([NEW_PATIENT_VISIT]),
        [BLOCKED_TIME_PATH]: () => {
          blockedCalls += 1;
          return blockedCalls === 1
            ? new Response("", { status: 500 })
            : jsonResponse([LUNCH_HOLD]);
        },
      });
      const user = userEvent.setup();
      render(<ProviderCalendar />);

      // Non-blocking: bookings and availability render normally alongside
      // the warning, and NOTHING is painted as blocked.
      expect(
        await screen.findByRole("button", { name: NEW_PATIENT_BLOCK })
      ).toBeInTheDocument();
      expect(screen.getByText("9 AM")).toBeInTheDocument();
      const warning = await screen.findByRole("status");
      expect(warning).toHaveTextContent(
        "Couldn't load your blocked time — the grid may show hours that are actually blocked."
      );
      expect(document.querySelectorAll(".hatch-unavailable")).toHaveLength(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      const profileCallsBefore = callsTo(fetchMock, PROFILE_PATH);
      const bookingsCallsBefore = callsTo(fetchMock, BOOKINGS_PATH);
      const availabilityCallsBefore = callsTo(fetchMock, AVAILABILITY_PATH);

      await user.click(within(warning).getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Blocked: Lunch, 10:00am–12:00pm")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // Scoped: only the blocked-time fetch re-fired.
      expect(callsTo(fetchMock, BLOCKED_TIME_PATH)).toBe(2);
      expect(callsTo(fetchMock, PROFILE_PATH)).toBe(profileCallsBefore);
      expect(callsTo(fetchMock, BOOKINGS_PATH)).toBe(bookingsCallsBefore);
      expect(callsTo(fetchMock, AVAILABILITY_PATH)).toBe(availabilityCallsBefore);
    });
  });
});
