import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderStep } from "./ProviderStep";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const PROVIDERS_PATH = "/scheduling/providers";

const PROVIDERS = [
  { id: 1, name: "Dr. Amara Osei", timezone: "America/New_York" },
  { id: 2, name: "Dr. Riley Chen", timezone: "America/Chicago" },
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

function renderStep(selectedProviderId: number | null = null, onSelect = vi.fn()) {
  render(<ProviderStep selectedProviderId={selectedProviderId} onSelect={onSelect} />);
  return { onSelect };
}

describe("ProviderStep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("shows a loading state while fetching providers", () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => new Promise(() => {}) });
    renderStep();

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
    renderStep();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load providers/i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Dr. Amara Osei")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no providers to book with", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse([]) });
    renderStep();

    expect(
      await screen.findByText(/no providers are available to book with/i)
    ).toBeInTheDocument();
  });

  it("does not show a generic load error on a 401 (the shared auth hook already redirects)", async () => {
    mockFetchRouter({
      [PROVIDERS_PATH]: () => new Response("", { status: 401 }),
      "/auth/refresh": () => new Response("", { status: 401 }),
    });
    renderStep();

    await screen.findByText(/loading providers/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists each provider with their timezone as a human name, never the raw IANA id", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS) });
    renderStep();

    expect(await screen.findByText("Dr. Amara Osei")).toBeInTheDocument();
    expect(screen.getByText("Eastern Time (New York)")).toBeInTheDocument();
    expect(screen.getByText("Central Time (Chicago)")).toBeInTheDocument();
    expect(screen.queryByText("America/New_York")).not.toBeInTheDocument();
  });

  it("calls onSelect with the clicked provider", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS) });
    const user = userEvent.setup();
    const { onSelect } = renderStep();

    await user.click(await screen.findByRole("button", { name: /Dr\. Riley Chen/ }));

    expect(onSelect).toHaveBeenCalledWith(PROVIDERS[1]);
  });

  it("marks the already-chosen provider as pressed when revisiting the step", async () => {
    mockFetchRouter({ [PROVIDERS_PATH]: () => jsonResponse(PROVIDERS) });
    renderStep(1);

    expect(await screen.findByRole("button", { name: /Dr\. Amara Osei/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /Dr\. Riley Chen/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
