import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingConfirmPanel } from "./BookingConfirmPanel";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const BOOKINGS_PATH = "/bookings";

const PROVIDER = { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" };
const APPOINTMENT_TYPE = { id: 10, name: "Annual Physical", duration_minutes: 30 };
// 15:00 UTC = 10:00am America/Chicago (CDT) = 11:00am America/New_York (EDT).
const SLOT = { start: "2026-08-18T15:00:00.000Z", end: "2026-08-18T15:30:00.000Z" };
const PATIENT_TIME_ZONE = "America/Chicago";

const BOOKING_RESPONSE = {
  id: 501,
  provider_id: PROVIDER.id,
  patient_id: 7,
  appointment_type_id: APPOINTMENT_TYPE.id,
  start_time: SLOT.start,
  end_time: SLOT.end,
  status: "confirmed",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetchRouter(
  handler: (init: RequestInit | undefined) => Response | Promise<Response>
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === BOOKINGS_PATH) {
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

function idempotencyKeyHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
}

function renderPanel(
  overrides: Partial<ComponentProps<typeof BookingConfirmPanel>> = {}
) {
  const onClose = vi.fn();
  const onBooked = vi.fn();
  const onSlotUnavailable = vi.fn();
  render(
    <BookingConfirmPanel
      provider={PROVIDER}
      appointmentType={APPOINTMENT_TYPE}
      slot={SLOT}
      patientTimeZone={PATIENT_TIME_ZONE}
      triggerElement={null}
      onClose={onClose}
      onBooked={onBooked}
      onSlotUnavailable={onSlotUnavailable}
      {...overrides}
    />
  );
  return { onClose, onBooked, onSlotUnavailable };
}

describe("BookingConfirmPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("renders a labeled dialog with the appointment details in both the patient's and the provider's timezone", () => {
    renderPanel();

    const dialog = screen.getByRole("dialog", { name: "Confirm your appointment" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText("Annual Physical with Dr. Amara Osei")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tuesday, August 18, 2026, 10:00am–10:30am — your time (America/Chicago)")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Provider's local time: Tuesday, August 18, 2026, 11:00am–11:30am (America/New_York)"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Reason for visit (optional)")
    ).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", () => {
    renderPanel();

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("disables the confirm button immediately on click, before the request resolves", async () => {
    let resolveRequest!: (response: Response) => void;
    mockFetchRouter(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        })
    );
    const user = userEvent.setup();
    renderPanel();

    const confirmButton = screen.getByRole("button", { name: "Confirm booking" });
    await user.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Booking…" })).toBeDisabled();

    resolveRequest(jsonResponse(BOOKING_RESPONSE, 201));
    await screen.findByRole("status");
  });

  it("double-clicking confirm sends at most one request", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = mockFetchRouter(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        })
    );
    const user = userEvent.setup();
    renderPanel();

    const confirmButton = screen.getByRole("button", { name: "Confirm booking" });
    await user.dblClick(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest(jsonResponse(BOOKING_RESPONSE, 201));
    await screen.findByRole("status");
  });

  it("sends provider_id, appointment_type_id, start_time in the body and an Idempotency-Key header generated for this panel session", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("status");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = requestBody(init);
    expect(body.provider_id).toBe(PROVIDER.id);
    expect(body.appointment_type_id).toBe(APPOINTMENT_TYPE.id);
    expect(body.start_time).toBe(SLOT.start);
    expect(body).not.toHaveProperty("idempotency_key");
    const key = idempotencyKeyHeader(init);
    expect(typeof key).toBe("string");
    expect(key).not.toBe("");
  });

  it("reuses the same Idempotency-Key header on a retry within the same panel session", async () => {
    let calls = 0;
    const fetchMock = mockFetchRouter(() => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(BOOKING_RESPONSE, 201);
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("status");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstKey = idempotencyKeyHeader(fetchMock.mock.calls[0][1] as RequestInit);
    const secondKey = idempotencyKeyHeader(fetchMock.mock.calls[1][1] as RequestInit);
    expect(secondKey).toBe(firstKey);
  });

  it("on success, shows a definitive confirmation with a reference number and reports the booked slot", async () => {
    mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    const { onBooked } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/you're booked/i);
    expect(confirmation).toHaveTextContent("Confirmation #501");
    expect(onBooked).toHaveBeenCalledWith(SLOT);
    // The form is gone -- can't double-book from a stale confirm button.
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
  });

  it("on a 409 conflict, shows the race-lost error and offers to choose another time", async () => {
    mockFetchRouter(() => new Response("", { status: 409 }));
    const user = userEvent.setup();
    const { onSlotUnavailable } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("This time is no longer available");
    expect(conflict).toHaveTextContent(
      "Someone else just booked it. Nothing was booked. Pick another time."
    );

    await user.click(screen.getByRole("button", { name: "Choose another time" }));
    expect(onSlotUnavailable).toHaveBeenCalledTimes(1);
  });

  it("on a generic failure, shows an actionable error and lets the patient retry", async () => {
    mockFetchRouter(() => new Response("", { status: 500 }));
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't book this appointment/i
    );
    expect(screen.getByRole("button", { name: "Confirm booking" })).not.toBeDisabled();
  });

  it("Escape closes the panel (does not book anything)", async () => {
    mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Cancel while a request is in flight", async () => {
    mockFetchRouter(
      () =>
        new Promise<Response>(() => {
          // never resolves
        })
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("Cancel calls onClose (before any submission)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus within the dialog, wrapping from the last focusable element to the first", async () => {
    const user = userEvent.setup();
    renderPanel();

    const closeButton = screen.getByRole("button", { name: "Close" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    cancelButton.focus();
    expect(cancelButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it("traps Shift+Tab, wrapping from the first focusable element to the last", async () => {
    const user = userEvent.setup();
    renderPanel();

    const closeButton = screen.getByRole("button", { name: "Close" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    closeButton.focus();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it("returns focus to the triggering element when the panel unmounts", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "9:00am";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <BookingConfirmPanel
        provider={PROVIDER}
        appointmentType={APPOINTMENT_TYPE}
        slot={SLOT}
        patientTimeZone={PATIENT_TIME_ZONE}
        triggerElement={trigger}
        onClose={vi.fn()}
        onBooked={vi.fn()}
        onSlotUnavailable={vi.fn()}
      />
    );

    unmount();

    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });

  it("does not throw when the triggering element is no longer in the document on unmount", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    document.body.removeChild(trigger); // detached before the panel closes

    const { unmount } = render(
      <BookingConfirmPanel
        provider={PROVIDER}
        appointmentType={APPOINTMENT_TYPE}
        slot={SLOT}
        patientTimeZone={PATIENT_TIME_ZONE}
        triggerElement={trigger}
        onClose={vi.fn()}
        onBooked={vi.fn()}
        onSlotUnavailable={vi.fn()}
      />
    );

    expect(() => unmount()).not.toThrow();
  });

  it("does not send the optional reason field to the backend", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    renderPanel();

    await user.type(
      screen.getByLabelText("Reason for visit (optional)"),
      "Follow-up on bloodwork"
    );
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = requestBody(fetchMock.mock.calls[0][1] as RequestInit);
    expect(body).not.toHaveProperty("reason");
  });
});
