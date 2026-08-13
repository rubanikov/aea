import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PatientCalendar } from "./PatientCalendar";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// Pin the browser-detected timezone to UTC at its real seam (the hook is
// the detection boundary, same spirit as stubbing `matchMedia` for the
// narrow-screen test): the machine running the tests can be in any zone,
// and the grid's hour-ruler/time-range assertions below need one fixed
// wall clock to be readable as literals.
vi.mock("@/hooks/use-patient-timezone", () => ({
  usePatientTimeZone: () => "UTC",
}));

const BOOKINGS_MINE_PATH = "/bookings/mine";

// "Now" for every test: Tuesday, August 18 2026, 09:00 UTC. With the
// detected zone pinned to UTC above, every fixture time below reads as its
// literal UTC wall time. The visible week is Mon Aug 17 – Sun Aug 23.
const NOW = new Date("2026-08-18T09:00:00.000Z");

const CONSULTATION = {
  id: 1,
  provider_id: 10,
  provider_name: "Dr. Amara Rossi",
  provider_timezone: "UTC",
  appointment_type_id: 5,
  appointment_type_name: "Consultation",
  start_time: "2026-08-18T15:00:00.000Z",
  end_time: "2026-08-18T15:45:00.000Z",
  status: "confirmed",
  reminder_sent: false,
  cancellation_reason: "",
};

const LAB_REVIEW = {
  id: 2,
  provider_id: 11,
  provider_name: "Dr. Noah Bergström",
  provider_timezone: "UTC",
  appointment_type_id: 6,
  appointment_type_name: "Lab Review",
  start_time: "2026-08-17T09:00:00.000Z",
  end_time: "2026-08-17T09:15:00.000Z",
  status: "completed",
  reminder_sent: true,
  cancellation_reason: "",
};

const CANCELLED_VISIT = {
  id: 3,
  provider_id: 12,
  provider_name: "Dr. Leila Haddad",
  provider_timezone: "UTC",
  appointment_type_id: 7,
  appointment_type_name: "Telehealth",
  start_time: "2026-08-20T13:00:00.000Z",
  end_time: "2026-08-20T13:30:00.000Z",
  status: "cancelled",
  reminder_sent: false,
  cancellation_reason: "Provider out of office",
};

// The FOLLOWING week (Tue Aug 25): must only appear after navigating.
const NEXT_WEEK_FOLLOW_UP = {
  id: 4,
  provider_id: 10,
  provider_name: "Dr. Amara Rossi",
  provider_timezone: "UTC",
  appointment_type_id: 8,
  appointment_type_name: "Follow-up",
  start_time: "2026-08-25T14:00:00.000Z",
  end_time: "2026-08-25T14:30:00.000Z",
  status: "confirmed",
  reminder_sent: false,
  cancellation_reason: "",
};

// Booked off an Eastern provider's schedule: 13:00Z is 9:00am on their
// clock (EDT, UTC-4 in August) but 1:00pm on this patient's (pinned UTC).
const EASTERN_VISIT = {
  id: 5,
  provider_id: 13,
  provider_name: "Dr. Ana Rossi",
  provider_timezone: "America/New_York",
  appointment_type_id: 9,
  appointment_type_name: "Annual Physical",
  start_time: "2026-08-18T13:00:00.000Z",
  end_time: "2026-08-18T14:00:00.000Z",
  status: "confirmed",
  reminder_sent: false,
  cancellation_reason: "",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes `fetch` by pathname, matching every other section's test router
 * in this codebase (e.g. `ProviderCalendar.test.tsx`). */
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

function callsTo(fetchMock: ReturnType<typeof mockFetchRouter>, path: string): number {
  return fetchMock.mock.calls.filter(([url]) => new URL(url as string).pathname === path)
    .length;
}

describe("PatientCalendar", () => {
  beforeEach(() => {
    // Freezes only `Date` (not setTimeout/setInterval), so `userEvent`/
    // `waitFor`/`findBy*` all keep working on real timers, exactly as in
    // every other test in this codebase.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while the appointment list loads", () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => new Promise(() => {}) });
    render(<PatientCalendar />);

    expect(screen.getByText(/loading your calendar/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when the list fails to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse([CONSULTATION]);
      },
    });
    const user = userEvent.setup();
    render(<PatientCalendar />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your calendar/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(
      await screen.findByText("Consultation — Dr. Amara Rossi")
    ).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<PatientCalendar />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the week as a time grid: day headers with today marked, a booking-derived hour ruler, and one block per booking with its status", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () =>
        jsonResponse([CONSULTATION, LAB_REVIEW, CANCELLED_VISIT, NEXT_WEEK_FOLLOW_UP]),
    });
    render(<PatientCalendar />);

    // One block per this-week booking, status carried as text (sr-only).
    expect(
      await screen.findByText("Consultation — Dr. Amara Rossi")
    ).toBeInTheDocument();
    expect(screen.getByText("3:00–3:45pm")).toBeInTheDocument();
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.getByText("Lab Review — Dr. Noah Bergström")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("Telehealth — Dr. Leila Haddad")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();

    // Next week's booking is filtered out client-side, not painted.
    expect(screen.queryByText("Follow-up — Dr. Amara Rossi")).not.toBeInTheDocument();

    // Day headers Mon–Sun, with today (Tue Aug 18) marked.
    expect(screen.getByText("Mon 17")).toBeInTheDocument();
    expect(screen.getByText("Sun 23")).toBeInTheDocument();
    expect(screen.getByText("Tue 18").closest('[aria-current="date"]')).not.toBeNull();

    // Hour ruler spans the hours the week's bookings cover (9:00–15:45).
    expect(screen.getByText("9 AM")).toBeInTheDocument();
    expect(screen.getByText("3 PM")).toBeInTheDocument();
    expect(screen.queryByText("7 AM")).not.toBeInTheDocument();

    // Week range label in the toolbar.
    expect(screen.getByText("Week of Aug 17–23, 2026")).toBeInTheDocument();
  });

  it("shows the provider's own clock on a block whose zone differs from the patient's", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([EASTERN_VISIT]),
    });
    render(<PatientCalendar />);

    // The grid's axis is the patient's clock, so the headline range has to
    // match the row the block sits in...
    expect(await screen.findByText("1:00–2:00pm")).toBeInTheDocument();
    // ...but the time the patient actually picked (and the one the
    // provider's office keeps) is never left off the block.
    expect(screen.getByText("9:00–10:00am provider's time")).toBeInTheDocument();
  });

  it("omits the provider's clock when it reads the same as the patient's", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([CONSULTATION]),
    });
    render(<PatientCalendar />);

    expect(await screen.findByText("3:00–3:45pm")).toBeInTheDocument();
    expect(screen.queryByText(/provider's time/)).not.toBeInTheDocument();
  });

  it("keeps blocks display-only: no clickable block and no status actions anywhere", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([CONSULTATION]),
    });
    render(<PatientCalendar />);

    const block = await screen.findByText("Consultation — Dr. Amara Rossi");
    expect(block.closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /mark completed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark no-show/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel/i })).not.toBeInTheDocument();
  });

  it("links the toolbar's primary CTA to the booking wizard route", async () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => jsonResponse([]) });
    render(<PatientCalendar />);

    const cta = await screen.findByRole("link", { name: "+ Book appointment" });
    expect(cta).toHaveAttribute("href", "/patient/book");
  });

  it("renders the default hour range with gridlines and an empty-week message when nothing is booked", async () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => jsonResponse([]) });
    render(<PatientCalendar />);

    expect(await screen.findByText("No appointments this week.")).toBeInTheDocument();
    // The calendar stays recognizable as a calendar: headers + ruler on
    // the 9–17 default range.
    expect(screen.getByText("Mon 17")).toBeInTheDocument();
    expect(screen.getByText("9 AM")).toBeInTheDocument();
    expect(screen.getByText("4 PM")).toBeInTheDocument();
  });

  it("navigates prev/next week and Today by re-filtering the one fetched list, never re-fetching", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([CONSULTATION, NEXT_WEEK_FOLLOW_UP]),
    });
    const user = userEvent.setup();
    render(<PatientCalendar />);

    expect(
      await screen.findByText("Consultation — Dr. Amara Rossi")
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, BOOKINGS_MINE_PATH)).toBe(1);

    await user.click(screen.getByRole("button", { name: "Go to next week" }));

    // The following week's booking appears purely from the already-held
    // list; this week's disappears.
    expect(await screen.findByText("Week of Aug 24–30, 2026")).toBeInTheDocument();
    expect(screen.getByText("Follow-up — Dr. Amara Rossi")).toBeInTheDocument();
    expect(screen.queryByText("Consultation — Dr. Amara Rossi")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByText("Week of Aug 17–23, 2026")).toBeInTheDocument();
    expect(screen.getByText("Consultation — Dr. Amara Rossi")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to previous week" }));
    expect(await screen.findByText("Week of Aug 10–16, 2026")).toBeInTheDocument();
    expect(screen.getByText("No appointments this week.")).toBeInTheDocument();

    expect(callsTo(fetchMock, BOOKINGS_MINE_PATH)).toBe(1);
  });

  it("jumps the grid to a day's week from the mini month, still without re-fetching", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([CONSULTATION, NEXT_WEEK_FOLLOW_UP]),
    });
    const user = userEvent.setup();
    render(<PatientCalendar />);

    await screen.findByText("Week of Aug 17–23, 2026");

    await user.click(screen.getByRole("button", { name: "Wednesday, August 26, 2026" }));

    expect(await screen.findByText("Week of Aug 24–30, 2026")).toBeInTheDocument();
    expect(screen.getByText("Follow-up — Dr. Amara Rossi")).toBeInTheDocument();
    expect(callsTo(fetchMock, BOOKINGS_MINE_PATH)).toBe(1);
  });

  it("shows the patient's browser-detected timezone in the sidebar, never a profile fetch", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([]),
    });
    render(<PatientCalendar />);

    // jsdom's detected zone is UTC.
    expect(
      await screen.findByText("Coordinated Universal Time (UTC)")
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, "/profile")).toBe(0);
  });

  it("falls back to the week-strip + read-only day list on narrow screens", async () => {
    // jsdom has no matchMedia; provide one that reports a narrow viewport.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([CONSULTATION, LAB_REVIEW]),
    });
    render(<PatientCalendar />);

    // The fallback: selected-day heading, day buttons with counts, and the
    // read-only rows — no grid headers.
    expect(
      await screen.findByRole("heading", { name: "Tuesday, August 18, 2026", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tuesday, August 18, 2026, 1 appointment" })
    ).toBeInTheDocument();
    expect(screen.getByText("Consultation — Dr. Amara Rossi")).toBeInTheDocument();
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.queryByText("Mon 17")).not.toBeInTheDocument();

    // The booking CTA is still reachable on narrow screens.
    expect(screen.getByRole("link", { name: "+ Book appointment" })).toHaveAttribute(
      "href",
      "/patient/book"
    );
  });

  it("shows the provider's own clock on the narrow-screen day list too", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([EASTERN_VISIT]),
    });
    render(<PatientCalendar />);

    expect(await screen.findByText("1:00–2:00pm")).toBeInTheDocument();
    expect(screen.getByText("9:00–10:00am provider's time")).toBeInTheDocument();
  });
});
