import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zonedTimeLabel } from "@/lib/availability/timezone";
import { formatBookingTimeRange } from "@/lib/bookings/format";
import { PatientAppointments } from "./PatientAppointments";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const BOOKINGS_MINE_PATH = "/bookings/mine";

// "Now" for every test: Wed, Aug 12 2026, 09:00 UTC. The browser's detected
// timezone in jsdom defaults to UTC, so this doubles as the patient's
// displayed timezone too.
const NOW = new Date("2026-08-12T09:00:00.000Z");

const UPCOMING_CONFIRMED = {
  id: 1,
  provider_id: 10,
  provider_name: "Dr. Amara Osei",
  provider_timezone: "UTC",
  appointment_type_name: "Annual Physical",
  start_time: "2026-08-18T15:00:00.000Z",
  end_time: "2026-08-18T15:30:00.000Z",
  status: "confirmed",
};

// Starts 14h from NOW: inside the 24h notice window.
const INSIDE_NOTICE_WINDOW = {
  id: 2,
  provider_id: 10,
  provider_name: "Dr. Amara Osei",
  provider_timezone: "UTC",
  appointment_type_name: "Lab Review",
  start_time: "2026-08-12T23:00:00.000Z",
  end_time: "2026-08-12T23:15:00.000Z",
  status: "confirmed",
};

const PAST_COMPLETED = {
  id: 3,
  provider_id: 11,
  provider_name: "Dr. Renata Silva",
  provider_timezone: "UTC",
  appointment_type_name: "Follow-up",
  start_time: "2026-08-01T13:00:00.000Z",
  end_time: "2026-08-01T13:15:00.000Z",
  status: "completed",
};

const CANCELLED_VISIT = {
  id: 4,
  provider_id: 11,
  provider_name: "Dr. Renata Silva",
  provider_timezone: "UTC",
  appointment_type_name: "Consultation",
  start_time: "2026-08-25T13:00:00.000Z",
  end_time: "2026-08-25T13:30:00.000Z",
  status: "cancelled",
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

describe("PatientAppointments", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while appointments load", () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => new Promise(() => {}) });
    render(<PatientAppointments />);

    expect(screen.getByText(/loading your appointments/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when the list fails to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse([UPCOMING_CONFIRMED]);
      },
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your appointments/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Annual Physical — Dr. Amara Osei")).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<PatientAppointments />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the empty state with a link back to the booking flow when there are no appointments at all", async () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => jsonResponse([]) });
    render(<PatientAppointments />);

    expect(
      await screen.findByText(/you don't have any appointments yet/i)
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Find a provider" });
    expect(link).toHaveAttribute("href", "/patient/book");
    // No tabs shown over an empty list.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("defaults to the Upcoming tab and shows only upcoming, still-confirmed bookings", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () =>
        jsonResponse([
          UPCOMING_CONFIRMED,
          INSIDE_NOTICE_WINDOW,
          PAST_COMPLETED,
          CANCELLED_VISIT,
        ]),
    });
    render(<PatientAppointments />);

    expect(
      await screen.findByText("Annual Physical — Dr. Amara Osei")
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Lab Review — Dr. Amara Osei")).toBeInTheDocument();
    expect(screen.queryByText("Follow-up — Dr. Renata Silva")).not.toBeInTheDocument();
    expect(screen.queryByText("Consultation — Dr. Renata Silva")).not.toBeInTheDocument();
  });

  it("switches to the Past tab and shows only past/closed bookings", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () =>
        jsonResponse([UPCOMING_CONFIRMED, PAST_COMPLETED, CANCELLED_VISIT]),
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    await user.click(screen.getByRole("tab", { name: "Past" }));

    expect(screen.getByText("Follow-up — Dr. Renata Silva")).toBeInTheDocument();
    expect(
      screen.queryByText("Annual Physical — Dr. Amara Osei")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Consultation — Dr. Renata Silva")
    ).not.toBeInTheDocument();
  });

  it("switches to the Cancelled tab and shows only cancelled bookings, regardless of start time", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: () => jsonResponse([UPCOMING_CONFIRMED, CANCELLED_VISIT]),
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    await user.click(screen.getByRole("tab", { name: "Cancelled" }));

    expect(screen.getByText("Consultation — Dr. Renata Silva")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    expect(
      screen.queryByText("Annual Physical — Dr. Amara Osei")
    ).not.toBeInTheDocument();
  });

  it("shows a clean per-tab empty message when a tab has no appointments but others do", async () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => jsonResponse([UPCOMING_CONFIRMED]) });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    await user.click(screen.getByRole("tab", { name: "Cancelled" }));

    expect(screen.getByText("No cancelled appointments.")).toBeInTheDocument();
  });

  it("cancels an appointment end to end: confirm step, PATCH /bookings/:id/cancel, moves it to the Cancelled tab without a full reload", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_MINE_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([UPCOMING_CONFIRMED]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/cancel": (init) => {
        if (init?.method === "PATCH") {
          // The real endpoint's response (`BookingSerializer`'s canonical
          // shape) has no `provider_name`/`appointment_type_name`. Only
          // `status` (plus other `_id` fields this UI doesn't use) is
          // real here, proving the card doesn't lose its display names by
          // blindly trusting this response as a full `PatientBooking`.
          return jsonResponse({
            id: 1,
            provider_id: 10,
            patient_id: 999,
            appointment_type_id: 55,
            start_time: UPCOMING_CONFIRMED.start_time,
            end_time: UPCOMING_CONFIRMED.end_time,
            status: "cancelled",
          });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    // Re-classified out of Upcoming (whose tab stays active) the moment the
    // PATCH resolves; no full page reload needed to see it move.
    await waitFor(() =>
      expect(screen.queryByText("Annual Physical — Dr. Amara Osei")).not.toBeInTheDocument()
    );
    expect(screen.getByText("No upcoming appointments.")).toBeInTheDocument();

    const patchCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/1/cancel")
    );
    expect(patchCall?.[1]).toMatchObject({ method: "PATCH" });

    await user.click(screen.getByRole("tab", { name: "Cancelled" }));
    // Still shows its real provider/type name, merged from the original
    // list fetch rather than overwritten by the cancel response.
    expect(screen.getByText("Annual Physical — Dr. Amara Osei")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });

  it("keeps Cancel disabled with a visible reason inside the 24h notice window", async () => {
    mockFetchRouter({ [BOOKINGS_MINE_PATH]: () => jsonResponse([INSIDE_NOTICE_WINDOW]) });
    render(<PatientAppointments />);

    const cancelButton = await screen.findByRole("button", { name: /^cancel:/i });
    expect(cancelButton).toBeDisabled();
    expect(
      screen.getByText(/Starts in 14h — inside the 24h change window/)
    ).toBeInTheDocument();
  });

  it("surfaces the server's specific rejection message when a cancel is rejected inside the notice window", async () => {
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([UPCOMING_CONFIRMED]);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      "/bookings/1/cancel": () =>
        jsonResponse(
          // Exact wording from `backend/bookings/exceptions.py`'s
          // `CancellationNoticeTooShort`.
          { detail: "This booking cannot be cancelled within 24 hours of its start time." },
          400
        ),
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This booking cannot be cancelled within 24 hours of its start time."
    );
    // Nothing was updated; still shown, still confirmed.
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
  });

  it("reschedules an appointment end to end: pick a new slot, confirm, PATCH /bookings/:id/reschedule, then refetches the list", async () => {
    const NEW_SLOT = { start: "2026-08-12T14:00:00.000Z", end: "2026-08-12T14:30:00.000Z" };
    // The patient's own timezone (`usePatientTimeZone`) is whatever this
    // machine/CI runner's own zone resolves to. This file's header comment
    // assumes that's UTC, which doesn't hold everywhere, so (like
    // `SlotBrowser.test.tsx`'s own `TODAY_KEY`/`TOMORROW_KEY`) the expected
    // display strings below are computed with the same conversion the
    // component itself uses rather than hardcoded against one assumed zone.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const newSlotButtonLabel = zonedTimeLabel(NEW_SLOT.start, zone);
    const oldRange = formatBookingTimeRange(
      UPCOMING_CONFIRMED.start_time,
      UPCOMING_CONFIRMED.end_time,
      zone
    );
    const newRange = formatBookingTimeRange(NEW_SLOT.start, NEW_SLOT.end, zone);
    let mineRequests = 0;
    mockFetchRouter({
      [BOOKINGS_MINE_PATH]: (init) => {
        if (init && (init.method ?? "GET") !== "GET") {
          throw new Error("unexpected call to the collection endpoint");
        }
        mineRequests += 1;
        // First load: the original booking. After the reschedule dialog's
        // "Done" triggers a refetch (`refetchBookings`, per this
        // component's own docstring), the old booking is now `cancelled`
        // and a new one exists at the new time, exactly the two-row
        // change a plain refetch (not a local merge) is meant to pick up.
        return mineRequests === 1
          ? jsonResponse([UPCOMING_CONFIRMED])
          : jsonResponse([
              {
                id: 501,
                provider_id: 10,
                provider_name: "Dr. Amara Osei",
                provider_timezone: "UTC",
                appointment_type_name: "Annual Physical",
                start_time: NEW_SLOT.start,
                end_time: NEW_SLOT.end,
                status: "confirmed",
              },
              {
                id: 1,
                provider_id: 10,
                provider_name: "Dr. Amara Osei",
                provider_timezone: "UTC",
                appointment_type_name: "Annual Physical",
                start_time: UPCOMING_CONFIRMED.start_time,
                end_time: UPCOMING_CONFIRMED.end_time,
                status: "cancelled",
              },
            ]);
      },
      "/scheduling/providers/10/appointment-types": () =>
        jsonResponse([{ id: 55, name: "Annual Physical", duration_minutes: 30 }]),
      // The reschedule picker renders on the provider's clock (see
      // `SlotBrowser`), so it resolves the provider's zone here. Given the
      // same zone as this runner, the expected labels above hold either way.
      "/scheduling/providers": () =>
        jsonResponse([{ id: 10, name: "Dr. Amara Osei", timezone: zone }]),
      "/scheduling/slots": () =>
        jsonResponse({
          provider_id: 10,
          appointment_type_id: 55,
          date_from: "irrelevant-to-this-test",
          date_to: "irrelevant-to-this-test",
          bookable: true,
          reason: null,
          slots: [NEW_SLOT],
        }),
      "/bookings/1/reschedule": (init) => {
        if (init?.method !== "PATCH") {
          throw new Error("unexpected call");
        }
        return jsonResponse({
          id: 501,
          provider_id: 10,
          patient_id: 999,
          appointment_type_id: 55,
          start_time: NEW_SLOT.start,
          end_time: NEW_SLOT.end,
          status: "confirmed",
          previous_booking_id: 1,
        });
      },
    });
    const user = userEvent.setup();
    render(<PatientAppointments />);

    await screen.findByText("Annual Physical — Dr. Amara Osei");
    expect(screen.getByText(new RegExp(oldRange))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^reschedule:/i }));
    await user.click(await screen.findByRole("button", { name: newSlotButtonLabel }));
    await user.click(await screen.findByRole("button", { name: "Confirm new time" }));
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Done" }));

    // The dialog is gone and the list reflects the change: the same
    // appointment card, now at its new time.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(new RegExp(newRange))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(oldRange))).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Cancelled" }));
    expect(screen.getByText(new RegExp(oldRange))).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });
});
