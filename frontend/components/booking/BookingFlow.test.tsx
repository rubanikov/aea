import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingFlow } from "./BookingFlow";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROVIDERS_PATH = "/scheduling/providers";
const SLOTS_PATH = "/scheduling/slots";

const PROVIDERS = [{ id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" }];
const TYPES = [{ id: 10, name: "Annual Physical", duration_minutes: 30 }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

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

describe("BookingFlow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    pushMock.mockClear();
  });

  it("starts on the service/provider picker", () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => new Promise(() => {}) });
    render(<BookingFlow />);

    expect(screen.getByText(/1\. choose a provider/i)).toBeInTheDocument();
  });

  it("moves into the slot browser once a provider and appointment type are chosen, and Back to services returns to the picker", async () => {
    // No `Intl.DateTimeFormat` mock here (unlike `use-patient-timezone.test.tsx`)
    // -- `SlotBrowser` also calls `new Intl.DateTimeFormat(...)` for real
    // zoned formatting, which a simple `resolvedOptions`-only stub can't
    // stand in for. These assertions don't depend on which zone gets
    // detected, so the real one (whatever this environment reports) is
    // fine to flow through untouched.
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(TYPES),
      [SLOTS_PATH]: () => new Promise(() => {}), // slot browser can stay loading for this test
    });
    const user = userEvent.setup();
    render(<BookingFlow />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));
    await user.click(await screen.findByRole("button", { name: "Annual Physical (30 min)" }));

    expect(
      await screen.findByRole("heading", {
        name: "Book: Annual Physical with Dr. Amara Osei",
      })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to services/i }));

    expect(await screen.findByText(/1\. choose a provider/i)).toBeInTheDocument();
  });
});
