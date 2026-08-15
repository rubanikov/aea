import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { zonedDateKey } from "@/lib/availability/timezone";
import { BookingWizard } from "./BookingWizard";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROVIDERS_PATH = "/scheduling/providers";
const SLOTS_PATH = "/scheduling/slots";
const BOOKINGS_PATH = "/bookings";

const OSEI = { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" };
const CHEN = { id: 2, name: "Dr. Riley Chen", timezone: "America/Chicago" };
const PROVIDERS = [OSEI, CHEN];

// `duration_minutes` is a per-type provider choice of 30 or 60; these
// fixtures use 60-minute types.
const OSEI_TYPES = [
  { id: 10, name: "Annual Physical", duration_minutes: 60 },
  { id: 11, name: "Follow-up", duration_minutes: 60 },
];
const CHEN_TYPES = [{ id: 20, name: "New Patient Intake", duration_minutes: 60 }];

// Today on the *provider's* clock, matching how `DateTimeStep` buckets days.
const TODAY_KEY = zonedDateKey(new Date().toISOString(), OSEI.timezone);
// 13:00/13:30 UTC = 9:00am/9:30am America/New_York (EDT), no day rollover.
const SLOT_9AM = { start: `${TODAY_KEY}T13:00:00.000Z`, end: `${TODAY_KEY}T13:30:00.000Z` };
const SLOT_930AM = { start: `${TODAY_KEY}T13:30:00.000Z`, end: `${TODAY_KEY}T14:00:00.000Z` };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function bookableResponse(providerId: number, slots: { start: string; end: string }[]) {
  return {
    provider_id: providerId,
    appointment_type_id: 0,
    date_from: "irrelevant-to-these-tests",
    date_to: "irrelevant-to-these-tests",
    bookable: true,
    reason: null,
    slots,
  };
}

/** Routes `fetch` by pathname; individual tests override specific paths. */
function mockFetchRouter(
  overrides: Partial<
    Record<string, (init: RequestInit | undefined, url: string) => Response | Promise<Response>>
  > = {}
) {
  const defaults: Record<
    string,
    (init: RequestInit | undefined, url: string) => Response | Promise<Response>
  > = {
    [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
    [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    [`${PROVIDERS_PATH}/2/appointment-types`]: () => jsonResponse(CHEN_TYPES),
    [SLOTS_PATH]: () => jsonResponse(bookableResponse(OSEI.id, [SLOT_9AM, SLOT_930AM])),
  };
  const handlers = { ...defaults, ...overrides };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (handler) {
      return Promise.resolve(handler(init, url));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function summaryRail() {
  return screen.getByRole("complementary", { name: "Your selections" });
}

/** Clicks through provider → service → slot, landing on the Confirm step. */
async function advanceToConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Dr\. Amara Osei/ }));
  await user.click(await screen.findByRole("button", { name: /Follow-up/ }));
  await user.click(await screen.findByRole("button", { name: /^9:00am/ }));
  await screen.findByRole("heading", { name: "Confirm your appointment" });
}

describe("BookingWizard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("books end to end: provider → provider-scoped service → slot → confirm → POST /bookings", async () => {
    const fetchMock = mockFetchRouter({
      [BOOKINGS_PATH]: () =>
        jsonResponse(
          {
            id: 501,
            provider_id: OSEI.id,
            patient_id: 7,
            appointment_type_id: 11,
            start_time: SLOT_9AM.start,
            end_time: SLOT_9AM.end,
            status: "confirmed",
          },
          201
        ),
    });
    const user = userEvent.setup();
    render(<BookingWizard />);

    // Step 1 is the active step out of the gate.
    expect(
      await screen.findByRole("heading", { name: "Choose a provider" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Dr\. Amara Osei/ }));

    // Step 2's list is scoped to the chosen provider.
    expect(await screen.findByText("Annual Physical")).toBeInTheDocument();
    const typesCall = fetchMock.mock.calls.find((call) =>
      call[0].toString().includes("/appointment-types")
    );
    expect(new URL(typesCall![0] as string).pathname).toBe(
      `${PROVIDERS_PATH}/${OSEI.id}/appointment-types`
    );

    await user.click(screen.getByRole("button", { name: /Follow-up/ }));

    // Step 3: pick the 9:00am slot (provider's clock is the primary label).
    await user.click(await screen.findByRole("button", { name: /^9:00am/ }));

    // Step 4: confirm.
    await screen.findByRole("heading", { name: "Confirm your appointment" });
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/you're booked/i);
    expect(confirmation).toHaveTextContent("Confirmation #501");

    const bookingCall = fetchMock.mock.calls.find(
      (call) => new URL(call[0] as string).pathname === BOOKINGS_PATH
    );
    const body = JSON.parse((bookingCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      provider_id: OSEI.id,
      appointment_type_id: 11,
      start_time: SLOT_9AM.start,
    });

    // Booked: the selections are history now, so no more "Change" buttons.
    expect(screen.queryByRole("button", { name: "Change provider" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change service" })).not.toBeInTheDocument();
  });

  it("keeps the summary rail in sync at every step, with edit links that jump back without clearing", async () => {
    mockFetchRouter();
    const user = userEvent.setup();
    render(<BookingWizard />);

    // Nothing chosen yet: three placeholders.
    await screen.findByRole("heading", { name: "Choose a provider" });
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /Dr\. Amara Osei/ }));
    await screen.findByRole("heading", { name: "Choose a service" });
    expect(within(summaryRail()).getByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(within(summaryRail()).getByText("Eastern Time (New York)")).toBeInTheDocument();
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(2);

    await user.click(await screen.findByRole("button", { name: /Follow-up/ }));
    await screen.findByRole("heading", { name: "Pick a date & time" });
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(1);

    await user.click(await screen.findByRole("button", { name: /^9:00am/ }));
    await screen.findByRole("heading", { name: "Confirm your appointment" });
    // The chosen slot, on the provider's clock.
    expect(within(summaryRail()).getByText(/9:00–9:30am/)).toBeInTheDocument();

    // The edit link itself clears nothing: jumping back to Provider keeps
    // every selection in the rail.
    await user.click(within(summaryRail()).getByRole("button", { name: "Change provider" }));
    await screen.findByRole("heading", { name: "Choose a provider" });
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();
    expect(within(summaryRail()).getByText(/9:00–9:30am/)).toBeInTheDocument();

    // Re-selecting the SAME provider is not a change either.
    await user.click(screen.getByRole("button", { name: /Dr\. Amara Osei/ }));
    await screen.findByRole("heading", { name: "Choose a service" });
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();
    expect(within(summaryRail()).getByText(/9:00–9:30am/)).toBeInTheDocument();
  });

  it("changing the provider clears both the service and the slot", async () => {
    mockFetchRouter();
    const user = userEvent.setup();
    render(<BookingWizard />);

    await advanceToConfirm(user);

    await user.click(within(summaryRail()).getByRole("button", { name: "Change provider" }));
    await user.click(await screen.findByRole("button", { name: /Dr\. Riley Chen/ }));

    await screen.findByRole("heading", { name: "Choose a service" });
    expect(within(summaryRail()).getByText("Dr. Riley Chen")).toBeInTheDocument();
    // Both downstream selections are gone.
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(2);
    expect(within(summaryRail()).queryByText("Follow-up (60 min)")).not.toBeInTheDocument();
  });

  it("changing the service clears the slot only", async () => {
    mockFetchRouter();
    const user = userEvent.setup();
    render(<BookingWizard />);

    await advanceToConfirm(user);

    await user.click(within(summaryRail()).getByRole("button", { name: "Change service" }));
    await user.click(await screen.findByRole("button", { name: /Annual Physical/ }));

    await screen.findByRole("heading", { name: "Pick a date & time" });
    expect(within(summaryRail()).getByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(within(summaryRail()).getByText("Annual Physical (60 min)")).toBeInTheDocument();
    // The slot is the only thing cleared.
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(1);
  });

  it("changing the date & time clears neither the provider nor the service", async () => {
    mockFetchRouter();
    const user = userEvent.setup();
    render(<BookingWizard />);

    await advanceToConfirm(user);

    await user.click(within(summaryRail()).getByRole("button", { name: "Change date & time" }));
    await user.click(await screen.findByRole("button", { name: /^9:30am/ }));

    await screen.findByRole("heading", { name: "Confirm your appointment" });
    expect(within(summaryRail()).getByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();
    expect(within(summaryRail()).getByText(/9:30–10:00am/)).toBeInTheDocument();
  });

  it("shows the zero-services empty state as real copy, not an error or blank screen", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse([]),
    });
    const user = userEvent.setup();
    render(<BookingWizard />);

    await user.click(await screen.findByRole("button", { name: /Dr\. Amara Osei/ }));

    expect(
      await screen.findByText(/hasn't set up any appointment types yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed fetch mid-wizard shows a scoped error with retry, without losing earlier selections", async () => {
    let slotsCalls = 0;
    mockFetchRouter({
      [SLOTS_PATH]: () => {
        slotsCalls += 1;
        return slotsCalls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(bookableResponse(OSEI.id, [SLOT_9AM]));
      },
    });
    const user = userEvent.setup();
    render(<BookingWizard />);

    await user.click(await screen.findByRole("button", { name: /Dr\. Amara Osei/ }));
    await user.click(await screen.findByRole("button", { name: /Follow-up/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load open slots/i);
    // The earlier steps' selections survive the failure.
    expect(within(summaryRail()).getByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("button", { name: /^9:00am/ })).toBeInTheDocument();
  });

  it("a 409 on confirm returns to slot selection and refetches the now-stale slot list", async () => {
    let slotsCalls = 0;
    mockFetchRouter({
      [SLOTS_PATH]: () => {
        slotsCalls += 1;
        return jsonResponse(bookableResponse(OSEI.id, [SLOT_9AM, SLOT_930AM]));
      },
      [BOOKINGS_PATH]: () => new Response("", { status: 409 }),
    });
    const user = userEvent.setup();
    render(<BookingWizard />);

    await advanceToConfirm(user);
    const slotsCallsBeforeConfirm = slotsCalls;
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("This time is no longer available");

    await user.click(screen.getByRole("button", { name: "Choose another time" }));

    // Back on the Date & time step, with a fresh slots fetch and the slot
    // cleared from the rail; provider and service are untouched.
    expect(await screen.findByRole("heading", { name: "Pick a date & time" })).toBeInTheDocument();
    await waitFor(() => expect(slotsCalls).toBe(slotsCallsBeforeConfirm + 1));
    expect(within(summaryRail()).getByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(within(summaryRail()).getByText("Follow-up (60 min)")).toBeInTheDocument();
    expect(within(summaryRail()).getAllByText("Not chosen yet")).toHaveLength(1);
  });
});
