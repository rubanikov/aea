import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Node 26 ships its own experimental `localStorage` global that shadows
 * jsdom's and evaluates to `undefined` unless Node is started with
 * `--localstorage-file`. Replace it with a plain in-memory implementation so
 * browser code under test (theme persistence, etc.) sees a working Storage.
 */
function memoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store = new Map();
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  value: memoryStorage(),
  configurable: true,
});

/**
 * jsdom has no `ResizeObserver`, but Radix's popper (Popover/Tooltip
 * positioning) requires one to exist. A no-op stand-in is enough: jsdom
 * does no layout, so there is nothing real to observe in tests anyway.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: NoopResizeObserver,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
