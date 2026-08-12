"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint: the width at which the provider calendar
 * switches from the agenda fallback to the week grid. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => {};
  }
  const list = window.matchMedia(DESKTOP_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  // jsdom (tests) has no matchMedia at all; default to the desktop grid,
  // which is the primary surface. A mobile-fallback test stubs matchMedia.
  if (typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * Whether the viewport is at or above the desktop breakpoint, as a real
 * JS condition rather than CSS `hidden lg:block` classes. The calendar
 * renders EITHER the week grid OR the agenda fallback — never both in the
 * DOM at once, which would double every button and heading for screen
 * readers (and for tests).
 *
 * Server rendering has no viewport, so SSR (and the first client paint
 * before hydration) assumes desktop; a narrow viewport corrects itself on
 * hydration.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
