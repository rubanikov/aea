"use client";

import { useSyncExternalStore } from "react";

// The browser's detected timezone never changes without a full page
// reload (there's no browser event for "the user's timezone changed"),
// so there's nothing to actually subscribe to. `useSyncExternalStore`
// still requires a `subscribe` function; this one just never fires it.
function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** No real visitor timezone exists on the server. `null` here (which
 * `getClientSnapshot` never returns) is what tells `useSyncExternalStore`
 * to report "not yet known" for the server-rendered/pre-hydration pass,
 * rather than guessing and risking a hydration mismatch against whatever
 * the client's real zone turns out to be. */
function getServerSnapshot(): string | null {
  return null;
}

/**
 * The patient's *current physical* timezone, detected from the browser
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`) rather than read
 * from their stored `GET /profile` value. A slot should display
 * unambiguously in the patient's local zone, meaning wherever they
 * physically are right now, since that's what actually determines what
 * time it reads on their wall clock, not necessarily wherever they last
 * set their profile to. A traveling patient's stored profile timezone can
 * silently go stale; the browser's zone can't, since it's re-detected on
 * every load. (A stored-profile selector, matching
 * `AppointmentTypesSection`'s read-only `GET /profile` timezone line, is
 * also defensible; this is a judgment call, not a uniquely correct
 * answer.)
 *
 * Built on `useSyncExternalStore` rather than a `useState` + `useEffect`
 * pair, which is exactly the case it exists for (React's own docs use the
 * near-identical `navigator.onLine` example): reading a browser-only,
 * external value whose server snapshot necessarily differs from the
 * client's, without the extra render `setState`-in-an-effect would cause.
 * Returns `null` (via `getServerSnapshot`) for the server-rendered/
 * pre-hydration pass, a real, if brief, loading state for callers to show
 * something for, never silently defaulting to `"UTC"`, which could
 * mislabel every slot time without any indication.
 */
export function usePatientTimeZone(): string | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
