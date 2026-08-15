import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { loginWithCredentials, redirectToRoleHome } from "./login-flow";

describe("loginWithCredentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the email and password to /auth/login", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await loginWithCredentials("pat@example.com", "secret123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/login");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ email: "pat@example.com", password: "secret123" })
    );
  });

  it("throws ApiError on bad credentials (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );

    await expect(
      loginWithCredentials("pat@example.com", "wrong")
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("redirectToRoleHome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a patient to /patient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: "1", email: "a@b.com", name: "Pat", role: "patient" }),
          { status: 200 }
        )
      )
    );
    const push = vi.fn();

    await redirectToRoleHome({ push });

    expect(push).toHaveBeenCalledWith("/patient");
  });

  it("sends a provider to /provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: "1", email: "a@b.com", name: "Riley", role: "provider" }),
          { status: 200 }
        )
      )
    );
    const push = vi.fn();

    await redirectToRoleHome({ push });

    expect(push).toHaveBeenCalledWith("/provider");
  });

  it("throws rather than silently returning to /login when no session is found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 }))
    );
    const push = vi.fn();

    await expect(redirectToRoleHome({ push })).rejects.toThrow(
      /no session was established/
    );
    expect(push).not.toHaveBeenCalled();
  });
});
