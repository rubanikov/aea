import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zonedDateKey } from "@/lib/availability/timezone";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import { SlotBrowser } from "./SlotBrowser";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const SLOTS_PATH = "/scheduling/slots";
const BOOKINGS_PATH = "/bookings";
const PATIENT_TIME_ZONE = "America/New_York";

const PROVIDER = { id: 1, name: "Dr. Amara Osei", timezone: PATIENT_TIME_ZONE };
const APPOINTMENT_TYPE = { id: 10, name: "Annual Physical", duration_minutes: 30 };

// Real "today"/"tomorrow" local-date keys, computed with the exact same
// zoned-conversion the component itself uses, never a hand-rolled
// UTC-slice, which would disagree with the component near local midnight.
const TODAY_KEY = zonedDateKey(new Date().toISOString(), PATIENT_TIME_ZONE);
const TOMORROW_KEY = zonedDateKey(
  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  PATIENT_TIME_ZONE
);

/** `dateKey` -> a UTC instant that lands on that same local calendar date
 * in `PATIENT_TIME_ZONE` (13:00 UTC = 9:00am EDT, no day rollover). */
function slotOn(key: string) {
  return { start: `${key}T13:00:00.000Z`, end: `${key}T13:30:00.000Z` };
}

function fullDateFromKey(key: string): string {
  const { year, month, day } = parseDateKey(key);
  return formatFullDate(year, month, day);
}

function dayAriaLabel(key: string, hasSlots: boolean): string {
  return hasSlots
    ? `${fullDateFromKey(key)}, has open slots`
    : `${fullDateFromKey(key)}, in the past, not bookable`;
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
  onSlots: (init: RequestInit | undefined, url: string) => Response | Promise<Response>,
  onBookings?: (init: RequestInit | undefined, url: string) => Response | Promise<Response>
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === SLOTS_PATH) {
      return Promise.resolve(onSlots(init, url));
    }
    if (path === BOOKINGS_PATH && onBookings) {
      return Promise.resolve(onBookings(init, url));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bookingResponseFor(slot: { start: string; end: string }) {
  return {
    id: 501,
    provider_id: PROVIDER.id,
    patient_id: 7,
    appointment_type_id: APPOINTMENT_TYPE.id,
    start_time: slot.start,
    end_time: slot.end,
    status: "confirmed",
  };
}

function renderBrowser(onBack = vi.fn()) {
  render(
    <SlotBrowser
      provider={PROVIDER}
      appointmentType={APPOINTMENT_TYPE}
      patientTimeZone={PATIENT_TIME_ZONE}
      onBack={onBack}
    />
  );
  return { onBack };
}

describe("SlotBrowser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows the service/provider summary and a loading state while fetching slots", () => {
    mockFetchRouter(() => new Promise(() => {}));
    renderBrowser();

    expect(
      screen.getByRole("heading", { name: "Book: Annual Physical with Dr. Amara Osei" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Service: Annual Physical (30 min) — Provider: Dr. Amara Osei")
    ).toBeInTheDocument();
    expect(screen.getByText(/loading open slots/i)).toBeInTheDocument();
  });

  it("shows an actionable error, with retry, when the slot fetch fails", async () => {
    let calls = 0;
    mockFetchRouter(() => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(bookableResponse([]));
    });
    const user = userEvent.setup();
    renderBrowser();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load open slots/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
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
    renderBrowser();

    expect(
      await screen.findByText("Provider has not configured any working hours yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Pick a date")).not.toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter(() => new Response("", { status: 401 }));
    renderBrowser();

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows today's open slots (the initial selected date) converted to the patient's timezone, plus the provider's own zone for context", async () => {
    mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    renderBrowser();

    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
    // The zone name itself is a separate `<strong>` node, so match the
    // surrounding sentence in parts rather than as one exact string.
    expect(screen.getByText(/shown in your timezone:/i)).toBeInTheDocument();
    expect(screen.getByText(PATIENT_TIME_ZONE, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/detected from your browser/i)).toBeInTheDocument();
    expect(screen.getByText(`Provider is in ${PROVIDER.timezone}`)).toBeInTheDocument();
    // 13:00 UTC -> 9:00am in America/New_York (EDT, UTC-4).
    expect(screen.getByRole("button", { name: "9:00am" })).toBeInTheDocument();
  });

  it("selecting a different date filters the already-loaded slots without firing a new request", async () => {
    const fetchMock = mockFetchRouter(() =>
      jsonResponse(bookableResponse([slotOn(TODAY_KEY), slotOn(TOMORROW_KEY)]))
    );
    const user = userEvent.setup();
    renderBrowser();

    await screen.findByRole("button", { name: "9:00am" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: dayAriaLabel(TOMORROW_KEY, true) })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: `Times for ${fullDateFromKey(TOMORROW_KEY)}` })
    ).toBeInTheDocument();
  });

  it("navigating to the next month fetches a new date range", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(bookableResponse([])));
    const user = userEvent.setup();
    renderBrowser();

    await screen.findByText("Pick a date");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Next month" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const secondUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get("date_from")).not.toBe(
      firstUrl.searchParams.get("date_from")
    );
  });

  it("calls onBack from both the top link and the Change service/provider button", async () => {
    mockFetchRouter(() => jsonResponse(bookableResponse([])));
    const user = userEvent.setup();
    const { onBack } = renderBrowser();

    await user.click(screen.getByRole("button", { name: /back to services/i }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await screen.findByText("Pick a date");
    await user.click(screen.getByRole("button", { name: "Change service/provider" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("clicking an open slot opens the confirm panel for that slot", async () => {
    mockFetchRouter(() => jsonResponse(bookableResponse([slotOn(TODAY_KEY)])));
    const user = userEvent.setup();
    renderBrowser();

    const slotButton = await screen.findByRole("button", { name: "9:00am" });
    await user.click(slotButton);

    const dialog = screen.getByRole("dialog", { name: "Confirm your appointment" });
    expect(
      within(dialog).getByText(`${APPOINTMENT_TYPE.name} with ${PROVIDER.name}`)
    ).toBeInTheDocument();
  });

  it("booking a slot removes it from the open list and shows a confirmation", async () => {
    const slot = slotOn(TODAY_KEY);
    mockFetchRouter(
      () => jsonResponse(bookableResponse([slot])),
      () => jsonResponse(bookingResponseFor(slot), 201)
    );
    const user = userEvent.setup();
    renderBrowser();

    const slotButton = await screen.findByRole("button", { name: "9:00am" });
    await user.click(slotButton);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/you're booked/i);

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "9:00am" })).not.toBeInTheDocument();
    expect(screen.getByText(/no slots left today/i)).toBeInTheDocument();
  });

  it("a 409 conflict shows the race-lost error and, on 'Choose another time', closes the panel and refetches the slot list", async () => {
    let slotsRequests = 0;
    const fetchMock = mockFetchRouter(
      () => {
        slotsRequests += 1;
        return jsonResponse(bookableResponse([slotOn(TODAY_KEY)]));
      },
      () => new Response("", { status: 409 })
    );
    const user = userEvent.setup();
    renderBrowser();

    const slotButton = await screen.findByRole("button", { name: "9:00am" });
    await user.click(slotButton);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("This time is no longer available");
    expect(fetchMock.mock.calls.some((call) => call[0].toString().includes(BOOKINGS_PATH))).toBe(
      true
    );

    await user.click(screen.getByRole("button", { name: "Choose another time" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(slotsRequests).toBe(2));
  });
});
