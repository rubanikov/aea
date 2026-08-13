import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceStep } from "./ServiceStep";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROVIDERS_PATH = "/scheduling/providers";

const PROVIDER = { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" };

// `duration_minutes` is server-fixed at 60: every appointment is a
// one-hour slot.
const OSEI_TYPES = [
  { id: 10, name: "Annual Physical", duration_minutes: 60 },
  { id: 11, name: "Follow-up", duration_minutes: 60 },
];

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

function renderStep(onSelect = vi.fn(), selectedAppointmentTypeId: number | null = null) {
  render(
    <ServiceStep
      provider={PROVIDER}
      selectedAppointmentTypeId={selectedAppointmentTypeId}
      onSelect={onSelect}
    />
  );
  return { onSelect };
}

describe("ServiceStep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("requests appointment types scoped to the chosen provider", async () => {
    const fetchMock = mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    renderStep();

    expect(await screen.findByText("Annual Physical")).toBeInTheDocument();
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe(`${PROVIDERS_PATH}/${PROVIDER.id}/appointment-types`);
  });

  it("shows a loading state while fetching, and which provider the services belong to", () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => new Promise(() => {}),
    });
    renderStep();

    expect(screen.getByText(/loading appointment types/i)).toBeInTheDocument();
    expect(screen.getByText("with Dr. Amara Osei")).toBeInTheDocument();
  });

  it("lists each service with its name and duration", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    renderStep();

    expect(await screen.findByText("Annual Physical")).toBeInTheDocument();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getAllByText("60 min")).toHaveLength(2);
  });

  it("shows a specific empty-state message for a provider with no appointment types configured", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse([]),
    });
    renderStep();

    expect(
      await screen.findByText(/hasn't set up any appointment types yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an actionable error, with retry, when appointment types fail to load", async () => {
    let calls = 0;
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => {
        calls += 1;
        return calls === 1 ? new Response("", { status: 500 }) : jsonResponse(OSEI_TYPES);
      },
    });
    const user = userEvent.setup();
    renderStep();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load this provider's appointment types/i
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Annual Physical")).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    renderStep();

    await screen.findByText(/loading appointment types/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onSelect with the clicked appointment type", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    const user = userEvent.setup();
    const { onSelect } = renderStep();

    await user.click(await screen.findByRole("button", { name: /Follow-up/ }));

    expect(onSelect).toHaveBeenCalledWith(OSEI_TYPES[1]);
  });

  it("marks the already-chosen service as pressed when revisiting the step", async () => {
    mockFetchRouter({
      [`${PROVIDERS_PATH}/1/appointment-types`]: () => jsonResponse(OSEI_TYPES),
    });
    renderStep(vi.fn(), 11);

    expect(await screen.findByRole("button", { name: /Follow-up/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /Annual Physical/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
