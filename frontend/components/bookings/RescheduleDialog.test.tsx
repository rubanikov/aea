import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zonedDateKey } from "@/lib/availability/timezone";
import type { PatientBooking } from "@/lib/bookings/types";
import { RescheduleDialog } from "./RescheduleDialog";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PATIENT_TIME_ZONE = "America/New_York";
const APPOINTMENT_TYPES_PATH = "/scheduling/providers/10/appointment-types";
const SLOTS_PATH = "/scheduling/slots";
const RESCHEDULE_PATH = "/bookings/1/reschedule";

// Starts well outside the notice window -- this dialog itself doesn't
// re-check that client-side (its caller, `AppointmentCard`, already gates
// opening it at all on that), so the fixture's own start time isn't
// otherwise significant here beyond being a fixed, known value to assert
// "From: ..." against.
const BOOKING: PatientBooking = {
  id: 1,
  provider_id: 10,
  provider_name: "Dr. Amara Osei",
  appointment_type_id: 100,
  appointment_type_name: "Annual Physical",
  start_time: "2026-08-18T15:00:00.000Z",
  end_time: "2026-08-18T15:30:00.000Z",
  status: "confirmed",
  reminder_sent: false,
};

const APPOINTMENT_TYPES = [
  { id: 77, name: "Annual Physical", duration_minutes: 30 },
  { id: 78, name: "Follow-up", duration_minutes: 15 },
];

// Real "today", computed the exact same way the component itself does --
// never a hand-rolled UTC slice, which would disagree near local midnight.
const TODAY_KEY = zonedDateKey(new Date().toISOString(), PATIENT_TIME_ZONE);

/** `dateKey` -> a UTC instant that lands on that same local calendar date in
 * `PATIENT_TIME_ZONE` (13:00 UTC = 9:00am EDT, no day rollover). */
function slotOn(key: string) {
  return { start: `${key}T13:00:00.000Z`, end: `${key}T13:30:00.000Z` };
}

const NEW_SLOT = slotOn(TODAY_KEY);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function bookableResponse(slots: { start: string; end: string }[]) {
  return {
    provider_id: BOOKING.provider_id,
    appointment_type_id: 77,
    date_from: "irrelevant-to-these-tests",
    date_to: "irrelevant-to-these-tests",
    bookable: true,
    reason: null,
    slots,
  };
}

function rescheduledResponse(slot: { start: string; end: string }) {
  return {
    id: 999,
    provider_id: BOOKING.provider_id,
    patient_id: 7,
    appointment_type_id: 77,
    start_time: slot.start,
    end_time: slot.end,
    status: "confirmed",
    previous_booking_id: BOOKING.id,
  };
}

/** Routes `fetch` by pathname, matching every other section's test router in
 * this codebase (e.g. `PatientAppointments.test.tsx`). */
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

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(init?.body as string);
}

function renderDialog(overrides: Partial<ComponentProps<typeof RescheduleDialog>> = {}) {
  const onClose = vi.fn();
  const onRescheduled = vi.fn();
  render(
    <RescheduleDialog
      booking={BOOKING}
      patientTimeZone={PATIENT_TIME_ZONE}
      triggerElement={null}
      onClose={onClose}
      onRescheduled={onRescheduled}
      {...overrides}
    />
  );
  return { onClose, onRescheduled };
}

/** Loads the picker (types + a single open slot) and clicks through to the
 * confirm step, for tests only interested in what happens from there on. */
async function openConfirmStep(
  fetchOverrides: Partial<
    Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>
  > = {}
) {
  const fetchMock = mockFetchRouter({
    [APPOINTMENT_TYPES_PATH]: () => jsonResponse(APPOINTMENT_TYPES),
    [SLOTS_PATH]: () => jsonResponse(bookableResponse([NEW_SLOT])),
    ...fetchOverrides,
  });
  const user = userEvent.setup();
  const { onClose, onRescheduled } = renderDialog();

  const slotButton = await screen.findByRole("button", { name: "9:00am" });
  await user.click(slotButton);
  await screen.findByRole("heading", { name: "Confirm new time" });

  return { user, fetchMock, onClose, onRescheduled };
}

describe("RescheduleDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("resolves the appointment type by name, then shows the same-provider slot picker", async () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => jsonResponse(APPOINTMENT_TYPES),
      [SLOTS_PATH]: () => jsonResponse(bookableResponse([NEW_SLOT])),
    });
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Reschedule appointment" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/loading rescheduling options/i)).toBeInTheDocument();

    expect(
      await screen.findByText(
        /Annual Physical with Dr\. Amara Osei \(30 min\) — currently/
      )
    ).toBeInTheDocument();
    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
    // 13:00 UTC -> 9:00am in America/New_York (EDT, UTC-4).
    expect(screen.getByRole("button", { name: "9:00am" })).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => new Promise(() => {}),
    });
    renderDialog();

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("shows an actionable error, with retry, when resolving the appointment type fails", async () => {
    let calls = 0;
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(APPOINTMENT_TYPES);
      },
      [SLOTS_PATH]: () => jsonResponse(bookableResponse([])),
    });
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load rescheduling options/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
  });

  it("shows a specific message when this appointment's service can no longer be found for the provider", async () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () =>
        jsonResponse([{ id: 78, name: "Follow-up", duration_minutes: 15 }]),
    });
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't find this appointment's service/i
    );
  });

  it("shows an actionable error, with retry, when loading open slots fails", async () => {
    let calls = 0;
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => jsonResponse(APPOINTMENT_TYPES),
      [SLOTS_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(bookableResponse([NEW_SLOT]));
      },
    });
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load open slots/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("button", { name: "9:00am" })).toBeInTheDocument();
  });

  it("shows the provider's not-bookable reason instead of a blank picker", async () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => jsonResponse(APPOINTMENT_TYPES),
      [SLOTS_PATH]: () =>
        jsonResponse({
          provider_id: BOOKING.provider_id,
          appointment_type_id: 77,
          date_from: "2026-01-01",
          date_to: "2026-01-31",
          bookable: false,
          reason: "Provider has not configured any working hours yet.",
          slots: [],
        }),
    });
    renderDialog();

    expect(
      await screen.findByText("Provider has not configured any working hours yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Pick a date")).not.toBeInTheDocument();
  });

  it("picking a slot shows the confirm step with the old time and the new time", async () => {
    await openConfirmStep();

    // Old: 15:00Z-15:30Z on Aug 18 is 11:00-11:30am EDT.
    expect(screen.getByText(/From:/)).toHaveTextContent(
      "From: Tuesday, August 18, 2026, 11:00–11:30am"
    );
    // New: 13:00Z-13:30Z (today) is 9:00-9:30am EDT.
    expect(screen.getByText(/To:/)).toHaveTextContent("9:00–9:30am");
  });

  it("'Choose a different time' returns to the picker without refetching slots", async () => {
    const { user, fetchMock } = await openConfirmStep();
    const callsBeforeBack = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Choose a different time" }));

    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeBack);
  });

  it("confirms the reschedule: sends the new start_time, shows success, and only reports onRescheduled/onClose on Done", async () => {
    const fetchMock = vi.fn();
    const { user, onClose, onRescheduled } = await openConfirmStep({
      [RESCHEDULE_PATH]: fetchMock.mockImplementation(() =>
        jsonResponse(rescheduledResponse(NEW_SLOT), 200)
      ),
    });

    await user.click(screen.getByRole("button", { name: "Confirm new time" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/appointment rescheduled/i);
    expect(confirmation).toHaveTextContent("9:00–9:30am");
    expect(onRescheduled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toMatchObject({ method: "PATCH" });
    expect(requestBody(call[0])).toEqual({ start_time: NEW_SLOT.start });

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onRescheduled).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("on a 409 conflict, shows the race-lost message and, on 'Choose another time', returns to the picker and refetches slots", async () => {
    let slotsRequests = 0;
    const { user } = await openConfirmStep({
      [SLOTS_PATH]: vi.fn().mockImplementation(() => {
        slotsRequests += 1;
        return jsonResponse(bookableResponse([NEW_SLOT]));
      }),
      [RESCHEDULE_PATH]: vi.fn().mockImplementation(() => new Response("", { status: 409 })),
    });
    // `openConfirmStep` already drove the initial slot load through to a
    // click, so the override above has already counted it once.
    expect(slotsRequests).toBe(1);

    await user.click(screen.getByRole("button", { name: "Confirm new time" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("This time is no longer available");

    await user.click(screen.getByRole("button", { name: "Choose another time" }));

    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
    await waitFor(() => expect(slotsRequests).toBe(2));
  });

  it("surfaces the server's specific 400 message inline (e.g. the notice window closed server-side)", async () => {
    // Exact wording `CancellationNoticeTooShort` uses server-side, reused
    // for reschedule's own notice-window rejection.
    const { user } = await openConfirmStep({
      [RESCHEDULE_PATH]: vi.fn().mockImplementation(() =>
        jsonResponse(
          { detail: "This booking cannot be cancelled within 24 hours of its start time." },
          400
        )
      ),
    });

    await user.click(screen.getByRole("button", { name: "Confirm new time" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This booking cannot be cancelled within 24 hours of its start time."
    );
    // Still on the confirm step -- can retry immediately.
    expect(screen.getByRole("button", { name: "Confirm new time" })).toBeEnabled();
  });

  it("falls back to a generic message on an unspecific failure (covers a wrong-owner 403 the same way)", async () => {
    const { user } = await openConfirmStep({
      [RESCHEDULE_PATH]: vi.fn().mockImplementation(() => new Response("", { status: 403 })),
    });

    await user.click(screen.getByRole("button", { name: "Confirm new time" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't reschedule this appointment/i
    );
  });

  it("Escape closes the dialog when not mid-request", async () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => new Promise(() => {}),
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the triggering element when the dialog unmounts", () => {
    mockFetchRouter({
      [APPOINTMENT_TYPES_PATH]: () => new Promise(() => {}),
    });
    const trigger = document.createElement("button");
    trigger.textContent = "Reschedule";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <RescheduleDialog
        booking={BOOKING}
        patientTimeZone={PATIENT_TIME_ZONE}
        triggerElement={trigger}
        onClose={vi.fn()}
        onRescheduled={vi.fn()}
      />
    );

    unmount();

    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });
});
