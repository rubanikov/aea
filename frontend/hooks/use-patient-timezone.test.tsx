import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePatientTimeZone } from "./use-patient-timezone";

describe("usePatientTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // No separate "is null on the first render" case here -- that `null` is
  // `getServerSnapshot`'s value, which `useSyncExternalStore` only ever
  // consults during real server rendering/hydration. `renderHook` uses a
  // plain client root (`createRoot`, not `hydrateRoot`), so it goes
  // straight to `getSnapshot`, the same as a real browser would once
  // hydrated.

  it("resolves to the browser-detected IANA zone", async () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "Asia/Kolkata" }),
        }) as unknown as Intl.DateTimeFormat
    );

    const { result } = renderHook(() => usePatientTimeZone());

    await waitFor(() => expect(result.current).toBe("Asia/Kolkata"));
  });
});
