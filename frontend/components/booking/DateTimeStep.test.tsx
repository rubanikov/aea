import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zonedDateTimeToUtcIso } from "@/lib/availability/timezone";
import { formatWeekRange } from "@/lib/bookings/week";
import { DateTimeStep } from "./DateTimeStep";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const SLOTS_PATH = "/scheduling/slots";
const PATIENT_TIME_ZONE = "America/New_York";

const PROVIDER = { id: 1, name: "Dr. Amara Osei", timezone: PATIENT_TIME_ZONE };
const APPOINTMENT_TYPE = { id: 10, name: "Annual Physical", duration_minutes: 30 };

// The whole file runs at a fixed instant — a Wednesday, mid-morning in
// every zone involved — so week/month geometry is deterministic instead of
// depending on which weekday the suite happens to run on. Only `Date` is
// faked; real timers keep `userEvent` and promise flushing working.
const NOW = new Date("2026-08-12T15:00:00.000Z");
const TODAY_KEY = "2026-08-12"; // Wednesday
const TOMORROW_KEY = "2026-08-13";
// August 2026's 6-week Sunday-first month grid (Aug 1 is a Saturday):
// leading days back to Sun Jul 26, 42 cells forward to Sat Sep 5. These
// are the exact `date_from`/`date_to` bounds the old month-calendar
// implementation fetched and the rebuilt one must keep fetching.
const AUGUST_GRID_FROM = "2026-07-26";
const AUGUST_GRID_TO = "2026-09-05";
const THIS_WEEK_LABEL = formatWeekRange("2026-08-10");
const NEXT_WEEK_LABEL = formatWeekRange("2026-08-17");

/** `dateKey` + UTC hour -> a 30-minute slot landing on that same local
 * calendar date in `PATIENT_TIME_ZONE` (13:00 UTC = 9:00am EDT). */
function slotOn(key: string, utcHour = 13) {
  const hh = String(utcHour).padStart(2, "0");
  return { start: `${key}T${hh}:00:00.000Z`, end: `${key}T${hh}:30:00.000Z` };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function bookableResponse(slots: { start: string; end: string }[]) {
  return {
    provider_id: PROVIDER.id,
    appointment_type_id: APPOINTMENT_TYPE.id,
    date_from: "irrelevant-to-these-tests",
    date_to: "irrelevant-to-these-tests",
    bookable: true,
    reason: null,
    slots,
  };
}

function mockFetchRouter(
  onSlots: (init: RequestInit | undefined, url: string) => Response | Promise<Response>
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === SLOTS_PATH) {
      return Promise.resolve(onSlots(init, url));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderStep(onSelectSlot = vi.fn()) {
  const view = render(
    <DateTimeStep
      provider={PROVIDER}
      appointmentType={APPOINTMENT_TYPE}
      patientTimeZone={PATIENT_TIME_ZONE}
      onSelectSlot={onSelectSlot}
    />
  );
  return { onSelectSlot, container: view.container };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  pushMock.mockClear();
});

describe("DateTimeStep", () => {
  it("shows a loading state while fetching slots", () => {
    mockFetchRouter(() => new Promise(() => {}));
    renderStep();

    expect(screen.getByText(/loading open slots/i)).toBeInTheDocument();
  });

  it("shows an actionable error, with retry, when the slot fetch fails", async () => {
    let calls = 0;
    mockFetchRouter(() => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(bookableResponse([]));
    });
    const user = userEvent.setup();
    renderStep();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load open slots/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(THIS_WEEK_LABEL)).toBeInTheDocument();
  });

  it("shows the provider's not-bookable reason instead of a blank grid when nothing is configured", async () => {
    mockFetchRouter(() =>
      jsonResponse({
        provider_id: PROVIDER.id,
        appointment_type_id: APPOINTMENT_TYPE.id,
        date_from: "2026-01-01",
        date_to: "2026-01-31",
        bookable: false,
        reason: "Provider has not configured any working hours yet.",
        slots: [],
      })
    );
    renderStep();

    expect(
      await screen.findByText("Provider has not configured any working hours yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText(THIS_WEEK_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Jump to a week" })).not.toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter(() => new Response("", { status: 401 }));
    renderStep();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows this week's open slots on the provider's clock, which here is the patient's too", async () => {
    mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    renderStep();

    expect(await screen.findByText(THIS_WEEK_LABEL)).toBeInTheDocument();
    // The zone name itself is a separate `<strong>` node, so match the
    // surrounding sentence in parts rather than as one exact string. The
    // zone is shown as its human name (`formatTimezone`), never the raw
    // IANA id.
    expect(screen.getByText(/dates and times shown in/i)).toBeInTheDocument();
    expect(
      screen.getByText("Eastern Time (New York)", { selector: "strong" })
    ).toBeInTheDocument();
    expect(screen.queryByText("America/New_York")).not.toBeInTheDocument();
    expect(screen.getByText(/that's your timezone too/i)).toBeInTheDocument();
    // 13:00 UTC -> 9:00am in America/New_York (EDT, UTC-4). No second
    // "your time" label when both zones are the same wall clock.
    expect(screen.getByRole("button", { name: "9:00am" })).toBeInTheDocument();
  });

  it("marks days that have open slots in the mini month", async () => {
    mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    renderStep();

    const miniMonth = await screen.findByRole("group", { name: "Jump to a week" });
    expect(
      within(miniMonth).getByRole("button", {
        name: "Wednesday, August 12, 2026, has open slots",
      })
    ).toBeInTheDocument();
    // A day with nothing open keeps its plain date name.
    expect(
      within(miniMonth).getByRole("button", { name: "Thursday, August 13, 2026" })
    ).toBeInTheDocument();
  });

  it("shows the whole week's slots from one request — no per-day fetching", async () => {
    const fetchMock = mockFetchRouter(() =>
      jsonResponse(bookableResponse([slotOn(TODAY_KEY, 13), slotOn(TOMORROW_KEY, 14)]))
    );
    renderStep();

    // Today's 9:00am and tomorrow's 10:00am are both on the grid at once.
    expect(await screen.findByRole("button", { name: "9:00am" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10:00am" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("navigating to another week in the same fetched month re-filters without a new request", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    const user = userEvent.setup();
    renderStep();

    await screen.findByRole("button", { name: "9:00am" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Go to next week" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(NEXT_WEEK_LABEL)).toBeInTheDocument();
    // Today's slot is in last week's columns now.
    expect(screen.queryByRole("button", { name: "9:00am" })).not.toBeInTheDocument();
    expect(screen.getByText(/no open times this week/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "9:00am" })).toBeInTheDocument();
  });

  it("jumping to a week in a different month fetches that month's date range", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(bookableResponse([])));
    const user = userEvent.setup();
    renderStep();

    await screen.findByText(THIS_WEEK_LABEL);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Mini-month: page to September, then jump to a day there.
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Tuesday, September 15, 2026" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get("date_from")).not.toBe(
      firstUrl.searchParams.get("date_from")
    );
    expect(await screen.findByText(formatWeekRange("2026-09-14"))).toBeInTheDocument();
  });

  it("fetches once on mount with the visible month's full 6-week grid bounds (same pattern as before the rebuild)", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(bookableResponse([])));
    renderStep();

    await screen.findByText(THIS_WEEK_LABEL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe(SLOTS_PATH);
    expect(url.searchParams.get("provider_id")).toBe(String(PROVIDER.id));
    expect(url.searchParams.get("appointment_type_id")).toBe(String(APPOINTMENT_TYPE.id));
    expect(url.searchParams.get("date_from")).toBe(AUGUST_GRID_FROM);
    expect(url.searchParams.get("date_to")).toBe(AUGUST_GRID_TO);
  });

  it("calls onSelectSlot with the clicked slot", async () => {
    const slot = slotOn(TODAY_KEY);
    mockFetchRouter(() => jsonResponse(bookableResponse([slot])));
    const user = userEvent.setup();
    const { onSelectSlot } = renderStep();

    await user.click(await screen.findByRole("button", { name: "9:00am" }));

    expect(onSelectSlot).toHaveBeenCalledWith(slot);
  });

  it("hatches not-bookable time with the shared texture and an accessible 'Unavailable' name", async () => {
    // One slot, 9:00–9:30am today. The grid's derived hour range is
    // widened to the 4-hour minimum (9am–1pm), so today hatches
    // 9:30am–1:00pm and each of the week's six other days hatches the
    // full 9:00am–1:00pm window.
    mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    const { container } = renderStep();

    await screen.findByRole("button", { name: "9:00am" });

    const hatches = container.querySelectorAll<HTMLElement>(".hatch-unavailable");
    expect(hatches.length).toBe(7);
    for (const hatch of hatches) {
      // Same pattern as the provider calendar's BlockedTimeRegion: the
      // texture itself is aria-hidden and never intercepts clicks meant
      // for a slot; a visually-hidden sibling carries the name.
      expect(hatch).toHaveAttribute("aria-hidden", "true");
      expect(hatch).toHaveClass("pointer-events-none");
    }
    expect(screen.getByText("Unavailable, 9:30am–1:00pm")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable, 9:00am–1:00pm")).toHaveLength(6);
    // Patient-facing copy, not the provider calendar's "Blocked".
    expect(screen.queryByText(/^Blocked/)).not.toBeInTheDocument();
  });
});

/**
 * Regression (ported from the retired `SlotBrowser.test.tsx` via the
 * previous `DateTimeStep`): the patient booking wizard and the provider's
 * own calendar have to plot the schedule on the *same* clock, or the two
 * screens disagree about what "1pm" means even though they read the same
 * rows.
 *
 * The reported case, reproduced exactly from `seed_demo`'s Dr. Ana Rossi
 * (America/New_York, Mon-Fri 08:00-15:00, 15-minute Follow-up) as seen from
 * a browser in America/Chicago: she is booked 13:00-13:15 and 08:00-08:15 on
 * her own calendar, so those two times must be the ones missing from the
 * patient's grid, and her whole 08:00-15:00 working day must be the range
 * the grid spans -- not the same instants relabelled an hour earlier.
 */
describe("DateTimeStep across a provider/viewer timezone difference", () => {
  const PROVIDER_TZ = "America/New_York";
  const VIEWER_TZ = "America/Chicago";
  const ROSSI = { id: 9, name: "Dr. Ana Rossi", timezone: PROVIDER_TZ };
  const FOLLOW_UP = { id: 1, name: "Follow-up", duration_minutes: 15 };
  const WORKING_DAY = TODAY_KEY; // the fixed Wednesday
  // The two slots Dr. Rossi's calendar already has an appointment in.
  const BOOKED = ["08:00", "13:00"];

  /** Every 15-minute slot in 08:00-15:00 provider-local except `BOOKED` --
   * i.e. exactly what `GET /scheduling/slots` returns for her that day. */
  function rossiSlots() {
    const slots: { start: string; end: string }[] = [];
    for (let minutes = 8 * 60; minutes + 15 <= 15 * 60; minutes += 15) {
      const at = (value: number) =>
        `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      if (BOOKED.includes(at(minutes))) {
        continue;
      }
      slots.push({
        start: zonedDateTimeToUtcIso(WORKING_DAY, at(minutes), PROVIDER_TZ),
        end: zonedDateTimeToUtcIso(WORKING_DAY, at(minutes + 15), PROVIDER_TZ),
      });
    }
    return slots;
  }

  function renderRossiDay() {
    mockFetchRouter(() =>
      jsonResponse({
        provider_id: ROSSI.id,
        appointment_type_id: FOLLOW_UP.id,
        date_from: WORKING_DAY,
        date_to: WORKING_DAY,
        bookable: true,
        reason: null,
        slots: rossiSlots(),
      })
    );
    const view = render(
      <DateTimeStep
        provider={ROSSI}
        appointmentType={FOLLOW_UP}
        patientTimeZone={VIEWER_TZ}
        onSelectSlot={vi.fn()}
      />
    );
    return { container: view.container };
  }

  it("does not offer times the provider's calendar already has an appointment in", async () => {
    renderRossiDay();

    // The slots either side of both appointments are genuinely free and must
    // still be offered.
    expect(await screen.findByRole("button", { name: /^8:15am/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1:15pm/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^8:00am/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^1:00pm/ })).not.toBeInTheDocument();
  });

  it("spans exactly the working hours the provider configured, no earlier and no later", async () => {
    renderRossiDay();

    // 08:00-15:00 in her zone: the last bookable 15-minute start is 2:45pm,
    // and nothing exists before 8am.
    expect(await screen.findByRole("button", { name: /^2:45pm/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^7:15am/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^7:45am/ })).not.toBeInTheDocument();
  });

  it("still tells the viewer what each time is on their own clock", async () => {
    renderRossiDay();

    // 8:15am in New York is 7:15am in Chicago -- shown, but never as the
    // primary label, so the two screens agree on what "8:15am" refers to.
    expect(
      await screen.findByRole("button", { name: "8:15am (7:15am your time)" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Eastern Time (New York)", { selector: "strong" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Central Time \(Chicago\)/)).toBeInTheDocument();
  });

  it("hatches her two booked windows as unavailable, on her clock", async () => {
    renderRossiDay();

    await screen.findByRole("button", { name: /^8:15am/ });

    // The 08:00 and 13:00 provider-local appointments are the only gaps
    // inside her working day, and they're named in HER wall clock.
    expect(screen.getByText("Unavailable, 8:00–8:15am")).toBeInTheDocument();
    expect(screen.getByText("Unavailable, 1:00–1:15pm")).toBeInTheDocument();
    // The week's six other days have nothing open: fully hatched
    // 8:00am–3:00pm windows.
    expect(screen.getAllByText("Unavailable, 8:00am–3:00pm")).toHaveLength(6);
  });
});
