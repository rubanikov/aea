import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServicePicker } from "./ServicePicker";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROVIDERS_PATH = "/scheduling/providers";

const PROVIDERS = [
  { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" },
  { id: 2, name: "Dr. Riley Chen", timezone: "America/Chicago" },
];

const OSEI_TYPES = [
  { id: 10, name: "Annual Physical", duration_minutes: 30 },
  { id: 11, name: "Follow-up", duration_minutes: 15 },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes `fetch` by pathname, matching `AppointmentTypesSection.test.tsx`'s
 * established convention -- this component fires independent requests
 * (providers, then a given provider's appointment types) that tests
 * shouldn't be coupled to the order of. */
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

describe("ServicePicker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching providers", () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => new Promise(() => {}) });
    render(<ServicePicker onSelect={vi.fn()} />);

    expect(screen.getByText(/loading providers/i)).toBeInTheDocument();
  });

  it("shows a specific, actionable error when providers fail to load, with a working retry", async () => {
    let calls = 0;
    mockFetchRouter({
      [PROVIDERS_PATH]: () => {
        calls += 1;
        return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(PROVIDERS);
      },
    });
    const user = userEvent.setup();
    render(<ServicePicker onSelect={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load providers/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Dr. Amara Osei")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no providers to book with", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse([]) });
    render(<ServicePicker onSelect={vi.fn()} />);

    expect(
      await screen.findByText(/no providers are available to book with/i)
    ).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [PROVIDERS_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    render(<ServicePicker onSelect={vi.fn()} />);

    await screen.findByText(/loading providers/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists providers, and does not yet show a service step before one is chosen", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS) });
    render(<ServicePicker onSelect={vi.fn()} />);

    expect(await screen.findByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(screen.getByText("Dr. Riley Chen")).toBeInTheDocument();
    expect(screen.queryByText(/choose a service/i)).not.toBeInTheDocument();
  });

  it("loads and shows the selected provider's appointment types, with name and duration", async () => {
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    const user = userEvent.setup();
    render(<ServicePicker onSelect={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));

    expect(await screen.findByText("Annual Physical (30 min)")).toBeInTheDocument();
    expect(screen.getByText("Follow-up (15 min)")).toBeInTheDocument();
  });

  it("shows a specific empty-state message for a provider with no appointment types configured", async () => {
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse([]),
    });
    const user = userEvent.setup();
    render(<ServicePicker onSelect={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));

    expect(
      await screen.findByText(/hasn't set up any appointment types yet/i)
    ).toBeInTheDocument();
  });

  it("shows an actionable error, with retry, when appointment types fail to load", async () => {
    let calls = 0;
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => {
        calls += 1;
        return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(OSEI_TYPES);
      },
    });
    const user = userEvent.setup();
    render(<ServicePicker onSelect={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load this provider's appointment types/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Annual Physical (30 min)")).toBeInTheDocument();
  });

  it("calls onSelect with the chosen provider and appointment type", async () => {
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ServicePicker onSelect={onSelect} />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));
    await user.click(await screen.findByRole("button", { name: "Follow-up (15 min)" }));

    expect(onSelect).toHaveBeenCalledWith(PROVIDERS[0], OSEI_TYPES[1]);
  });

  it("switching to a different provider re-fetches that provider's own appointment types", async () => {
    const otherTypes = [{ id: 20, name: "New Patient Intake", duration_minutes: 45 }];
    mockFetchRouter({
      [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS),
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
      [`${PROVIDERS_PATH}/2/appointment-types`]: () => jsonResponse(otherTypes),
    });
    const user = userEvent.setup();
    render(<ServicePicker onSelect={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Dr. Amara Osei" }));
    expect(await screen.findByText("Annual Physical (30 min)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dr. Riley Chen" }));

    expect(await screen.findByText("New Patient Intake (45 min)")).toBeInTheDocument();
    expect(screen.queryByText("Annual Physical (30 min)")).not.toBeInTheDocument();
  });
});
