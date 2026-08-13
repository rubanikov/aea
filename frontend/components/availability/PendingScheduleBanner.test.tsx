import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PendingScheduleBanner } from "./PendingScheduleBanner";
import type { ScheduleWindow } from "@/lib/availability/types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PENDING_PATH = "/scheduling/schedule/pending";

/** Routes `fetch` by exact pathname, same shape as
 * `WorkingHoursSection.test.tsx`'s router. */
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

// Live hours: Mon 09:00–17:00, Fri 09:00–17:00.
const CURRENT_WINDOWS: ScheduleWindow[] = [
  { id: 1, day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00" },
  { id: 2, day_of_week: 4, start_time: "09:00:00", end_time: "17:00:00" },
];

// Pending: Monday splits into two blocks, Friday drops entirely.
const PENDING_WINDOWS: ScheduleWindow[] = [
  { id: 9, day_of_week: 0, start_time: "09:00:00", end_time: "12:00:00" },
  { id: 10, day_of_week: 0, start_time: "14:00:00", end_time: "17:00:00" },
];

function renderBanner(
  overrides: Partial<Parameters<typeof PendingScheduleBanner>[0]> = {}
) {
  const props = {
    effectiveFrom: "2026-08-25",
    pendingWindows: PENDING_WINDOWS,
    currentWindows: CURRENT_WINDOWS,
    editingPending: false,
    onEditPending: vi.fn(),
    onCancelled: vi.fn(),
    ...overrides,
  };
  render(<PendingScheduleBanner {...props} />);
  return props;
}

describe("PendingScheduleBanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows the effective date, the stay-live subline, and a diff of only the days that change", () => {
    renderBanner();

    expect(
      screen.getByText(
        /scheduled change: new hours take effect Tuesday, August 25, 2026/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/\(clinic time\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/until then, your current hours below stay live for booking/i)
    ).toBeInTheDocument();
    // Monday and Friday change; the untouched days don't appear in the diff.
    expect(
      screen.getByText(
        /pending: Mon 09:00–12:00 and 14:00–17:00 \(currently 09:00–17:00\); Fri unavailable \(currently 09:00–17:00\)\./i
      )
    ).toBeInTheDocument();
  });

  it("expands and collapses the read-only Mon–Sun pending summary", async () => {
    const user = userEvent.setup();
    renderBanner();

    const toggle = screen.getByRole("button", { name: /show full pending schedule/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: /full pending schedule/i })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: /full pending schedule/i });
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("Monday09:00–12:00 and 14:00–17:00");
    expect(rows[4]).toHaveTextContent("Fridayunavailable");
    expect(rows[6]).toHaveTextContent("Sundayunavailable");

    await user.click(screen.getByRole("button", { name: /hide full pending schedule/i }));

    expect(screen.queryByRole("list", { name: /full pending schedule/i })).not.toBeInTheDocument();
  });

  it("'Edit pending change' hands off to the parent", async () => {
    const user = userEvent.setup();
    const { onEditPending } = renderBanner();

    await user.click(screen.getByRole("button", { name: /edit pending change/i }));

    expect(onEditPending).toHaveBeenCalledTimes(1);
  });

  it("shows the editing note while the parent has the pending hours in the form", () => {
    renderBanner({ editingPending: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      /editing pending change — saving the form below replaces this scheduled change/i
    );
  });

  it("'Cancel pending change' asks an inline confirm; 'Keep it' backs out without a DELETE", async () => {
    const fetchMock = mockFetchRouter({});
    const user = userEvent.setup();
    const { onCancelled } = renderBanner();

    await user.click(screen.getByRole("button", { name: /cancel pending change/i }));

    expect(
      screen.getByText(/cancel this scheduled change\? your current hours stay live/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /keep it/i }));

    expect(
      screen.queryByText(/cancel this scheduled change\?/i)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel pending change/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it("confirming sends DELETE /scheduling/schedule/pending and reports success to the parent", async () => {
    const fetchMock = mockFetchRouter({
      [PENDING_PATH]: () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    const { onCancelled } = renderBanner();

    await user.click(screen.getByRole("button", { name: /cancel pending change/i }));
    await user.click(screen.getByRole("button", { name: /yes, cancel it/i }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("shows an inline error on a failed DELETE and succeeds on retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [PENDING_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    const { onCancelled } = renderBanner();

    await user.click(screen.getByRole("button", { name: /cancel pending change/i }));
    await user.click(screen.getByRole("button", { name: /yes, cancel it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't cancel the scheduled change — please try again/i
    );
    expect(onCancelled).not.toHaveBeenCalled();

    // The confirm row stays, so "Yes, cancel it" doubles as the retry.
    await user.click(screen.getByRole("button", { name: /yes, cancel it/i }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
  });

  it("explains a 404 (the pending change is already gone) instead of the generic error", async () => {
    mockFetchRouter({
      [PENDING_PATH]: () =>
        new Response(JSON.stringify({ detail: "No pending schedule change." }), {
          status: 404,
        }),
    });
    const user = userEvent.setup();
    const { onCancelled } = renderBanner();

    await user.click(screen.getByRole("button", { name: /cancel pending change/i }));
    await user.click(screen.getByRole("button", { name: /yes, cancel it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /this scheduled change no longer exists — please reload the page/i
    );
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
