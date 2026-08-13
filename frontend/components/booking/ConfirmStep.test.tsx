import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmStep } from "./ConfirmStep";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const BOOKINGS_PATH = "/bookings";

const PROVIDER = { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" };
// `duration_minutes` is server-fixed at 60: every appointment is a
// one-hour slot.
const APPOINTMENT_TYPE = { id: 10, name: "Annual Physical", duration_minutes: 60 };
// 14:00 UTC = 9:00am America/Chicago (CDT) = 10:00am America/New_York (EDT).
const SLOT = { start: "2026-08-18T14:00:00.000Z", end: "2026-08-18T15:00:00.000Z" };
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

function renderStep(overrides: Partial<ComponentProps<typeof ConfirmStep>> = {}) {
  const onBooked = vi.fn();
  const onSlotUnavailable = vi.fn();
  const onStartOver = vi.fn();
  render(
    <ConfirmStep
      provider={PROVIDER}
      appointmentType={APPOINTMENT_TYPE}
      slot={SLOT}
      patientTimeZone={PATIENT_TIME_ZONE}
      onBooked={onBooked}
      onSlotUnavailable={onSlotUnavailable}
      onStartOver={onStartOver}
      {...overrides}
    />
  );
  return { onBooked, onSlotUnavailable, onStartOver };
}

describe("ConfirmStep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows the appointment details in both timezones, as human names, provider's clock first", () => {
    renderStep();

    expect(
      screen.getByRole("heading", { name: "Confirm your appointment" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Annual Physical (60 min) with Dr. Amara Osei")
    ).toBeInTheDocument();
    // The provider's clock leads, matching the slot button that opened this
    // step; the patient's own local time follows it. Zones are shown via
    // `formatTimezone`, never as raw IANA ids.
    expect(
      screen.getByText(
        "Tuesday, August 18, 2026, 10:00–11:00am — provider's local time (Eastern Time (New York))"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your local time: Tuesday, August 18, 2026, 9:00–10:00am (Central Time (Chicago))"
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/America\/New_York/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reason for visit (optional)")).toBeInTheDocument();
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
    renderStep();

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
    renderStep();

    await user.dblClick(screen.getByRole("button", { name: "Confirm booking" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest(jsonResponse(BOOKING_RESPONSE, 201));
    await screen.findByRole("status");
  });

  it("sends provider_id, appointment_type_id, start_time in the body and an Idempotency-Key header generated for this step session", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    renderStep();

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

  it("reuses the same Idempotency-Key header on a retry within the same step session", async () => {
    let calls = 0;
    const fetchMock = mockFetchRouter(() => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(BOOKING_RESPONSE, 201);
    });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("status");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstKey = idempotencyKeyHeader(fetchMock.mock.calls[0][1] as RequestInit);
    const secondKey = idempotencyKeyHeader(fetchMock.mock.calls[1][1] as RequestInit);
    expect(secondKey).toBe(firstKey);
  });

  it("on success, shows a definitive confirmation with a reference number and reports the created booking", async () => {
    mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    const { onBooked } = renderStep();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/you're booked/i);
    expect(confirmation).toHaveTextContent("Confirmation #501");
    expect(onBooked).toHaveBeenCalledWith(BOOKING_RESPONSE);
    // The form is gone; can't double-book from a stale confirm button.
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
  });

  it("offers to start a fresh booking from the success view", async () => {
    mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    const { onStartOver } = renderStep();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("status");

    await user.click(screen.getByRole("button", { name: "Book another appointment" }));

    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  it("on a 409 conflict, shows the race-lost error and offers to choose another time", async () => {
    mockFetchRouter(() => new Response("", { status: 409 }));
    const user = userEvent.setup();
    const { onSlotUnavailable } = renderStep();

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
    renderStep();

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't book this appointment/i
    );
    expect(screen.getByRole("button", { name: "Confirm booking" })).not.toBeDisabled();
  });

  it("does not send the optional reason field to the backend", async () => {
    const fetchMock = mockFetchRouter(() => jsonResponse(BOOKING_RESPONSE, 201));
    const user = userEvent.setup();
    renderStep();

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
