import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppointmentTypesSection } from "./AppointmentTypesSection";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const TYPES_PATH = "/scheduling/appointment-types";

// `duration_minutes` is a per-type provider choice of 30 or 60; the mixed
// pair here exercises both display labels.
const SAMPLE_TYPES = [
  { id: 1, name: "New Patient Visit", duration_minutes: 60 },
  { id: 2, name: "Follow-up", duration_minutes: 30 },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Routes `fetch` by pathname rather than call order, since this section
 * fires two independent requests on mount (appointment types + the
 * timezone line's `GET /profile`), so tests shouldn't be coupled to which
 * fires first. `/profile` defaults to a successful, minimal response
 * unless a test overrides it.
 */
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
    if (path === "/profile") {
      return Promise.resolve(jsonResponse({ timezone: "America/New_York" }));
    }
    throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AppointmentTypesSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching", () => {
    mockFetchRouter({ [TYPES_PATH]: () => new Promise(() => {}) });
    render(<AppointmentTypesSection />);

    expect(screen.getByText(/loading appointment types/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when the list fails to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [TYPES_PATH]: () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 500 })
          : jsonResponse(SAMPLE_TYPES);
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your appointment types/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("New Patient Visit")).toBeInTheDocument();
  });

  it("shows the empty-state message and CTA, not a blank list, when there are no appointment types yet", async () => {
    mockFetchRouter({ [TYPES_PATH]: () => jsonResponse([]) });
    render(<AppointmentTypesSection />);

    expect(
      await screen.findByText(
        "Add at least one appointment type before patients can book with you."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add type" })).toBeInTheDocument();
  });

  it("renders each appointment type with its own chosen slot length and disambiguating row actions", async () => {
    mockFetchRouter({ [TYPES_PATH]: () => jsonResponse(SAMPLE_TYPES) });
    render(<AppointmentTypesSection />);

    expect(await screen.findByText("New Patient Visit")).toBeInTheDocument();
    expect(screen.getByText("60 minutes")).toBeInTheDocument();
    expect(screen.getByText("30 minutes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove New Patient Visit appointment type" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Follow-up appointment type" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Follow-up appointment type" })
    ).toBeInTheDocument();
  });

  it("displays the provider's timezone as a friendly label (never the raw IANA id), read-only, from GET /profile", async () => {
    mockFetchRouter({ [TYPES_PATH]: () => jsonResponse(SAMPLE_TYPES) });
    render(<AppointmentTypesSection />);

    expect(
      await screen.findByText(/timezone: eastern time \(new york\)/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/america\/new_york/i)).not.toBeInTheDocument();
  });

  it("adds a new appointment type: opens the form focused with 60 minutes preselected, validates the name inline, then POSTs and shows the new row", async () => {
    const fetchMock = mockFetchRouter({
      [TYPES_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse(SAMPLE_TYPES);
        }
        if (init.method === "POST") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ id: 3, ...body }, 201);
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    await user.click(await screen.findByRole("button", { name: "+ Add type" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    // The slot-length radios: the server default (60) starts selected.
    expect(screen.getByRole("radio", { name: "60 minutes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "30 minutes" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Add type" }));
    expect(screen.getByText("Name is required")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Lab Review");
    await user.click(screen.getByRole("button", { name: "Add type" }));

    expect(await screen.findByText("Lab Review")).toBeInTheDocument();
    expect(screen.getAllByText("60 minutes")).toHaveLength(2);

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(
      JSON.parse((postCall?.[1] as RequestInit).body as string)
    ).toEqual({ name: "Lab Review", duration_minutes: 60 });
  });

  it("adds a 30-minute appointment type when the 30-minute slot length is selected", async () => {
    const fetchMock = mockFetchRouter({
      [TYPES_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse([]);
        }
        if (init.method === "POST") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ id: 3, ...body }, 201);
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(screen.getByLabelText("Name"), "Quick Check");
    await user.click(screen.getByRole("radio", { name: "30 minutes" }));
    await user.click(screen.getByRole("button", { name: "Add type" }));

    expect(await screen.findByText("Quick Check")).toBeInTheDocument();
    expect(screen.getByText("30 minutes")).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(
      JSON.parse((postCall?.[1] as RequestInit).body as string)
    ).toEqual({ name: "Quick Check", duration_minutes: 30 });
  });

  it("edits an appointment type inline: prefilled name and slot length, PATCHes on save, and updates the row", async () => {
    const fetchMock = mockFetchRouter({
      [TYPES_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse(SAMPLE_TYPES);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      [`${TYPES_PATH}/2`]: (init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          return jsonResponse({ id: 2, ...body });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    await user.click(
      await screen.findByRole("button", { name: "Edit Follow-up appointment type" })
    );

    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toHaveValue("Follow-up");
    // The row's own slot length (30, per SAMPLE_TYPES) starts selected.
    expect(screen.getByRole("radio", { name: "30 minutes" })).toBeChecked();
    await user.clear(nameInput);
    await user.type(nameInput, "Quick Follow-up");
    await user.click(screen.getByRole("radio", { name: "60 minutes" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Quick Follow-up")).toBeInTheDocument();

    const patchCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/2")
    );
    expect(
      JSON.parse((patchCall?.[1] as RequestInit).body as string)
    ).toEqual({ name: "Quick Follow-up", duration_minutes: 60 });
  });

  it("shows a specific message with the affected count when a slot-length change is refused (409)", async () => {
    mockFetchRouter({
      [TYPES_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse(SAMPLE_TYPES);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      [`${TYPES_PATH}/2`]: (init) => {
        if (init?.method === "PATCH") {
          // `AppointmentTypeDetailView.patch`'s duration-collision body.
          return jsonResponse(
            {
              detail:
                "This appointment type has upcoming booked appointments at its current length.",
              collisions: [
                {
                  id: 7,
                  start_time: "2026-08-24T13:00:00Z",
                  end_time: "2026-08-24T13:30:00Z",
                  patient_name: "Pat Doe",
                  appointment_type_name: "Follow-up",
                  status: "confirmed",
                },
                {
                  id: 8,
                  start_time: "2026-08-25T13:00:00Z",
                  end_time: "2026-08-25T13:30:00Z",
                  patient_name: "Sam Roe",
                  appointment_type_name: "Follow-up",
                  status: "confirmed",
                },
              ],
            },
            409
          );
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    await user.click(
      await screen.findByRole("button", { name: "Edit Follow-up appointment type" })
    );
    await user.click(screen.getByRole("radio", { name: "60 minutes" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /can't change the slot length: 2 upcoming appointments/i
    );
    // Still in edit mode -- the provider can switch the radio back or
    // cancel; nothing was silently saved.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("requires confirmation before removing an appointment type, and only DELETEs after confirming", async () => {
    const fetchMock = mockFetchRouter({
      [TYPES_PATH]: (init) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return jsonResponse(SAMPLE_TYPES);
        }
        throw new Error("unexpected call to the collection endpoint");
      },
      [`${TYPES_PATH}/2`]: (init) => {
        if (init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error("unexpected call");
      },
    });
    const user = userEvent.setup();
    render(<AppointmentTypesSection />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Follow-up appointment type" })
    );
    expect(screen.getByText(/remove follow-up\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).endsWith("/2"))
    ).toBe(false);

    await user.click(
      screen.getByRole("button", { name: "Remove Follow-up appointment type" })
    );
    await user.click(screen.getByRole("button", { name: "Confirm remove" }));

    await screen.findByRole("button", { name: "+ Add type" });
    expect(screen.queryByText("Follow-up")).not.toBeInTheDocument();
    expect(screen.getByText("New Patient Visit")).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [TYPES_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<AppointmentTypesSection />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/login?session_expired=1")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
