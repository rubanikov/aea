"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  parseStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme/theme";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage denied (e.g. Safari private mode): behave as "system".
    return "system";
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/* Mounted-detector: the server snapshot is `false`, the client snapshot is
   `true`, and React swaps between them without a hydration mismatch. Lets us
   expose server-safe defaults during SSR/hydration and the real preference
   right after. */
const emptySubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

/**
 * Owns the theme preference after hydration. The pre-paint script in
 * app/layout.tsx has already put the right `dark` class on `<html>` before
 * first paint; this provider adopts that decision and takes over from there
 * (toggle, persistence, live OS-preference tracking).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(emptySubscribe, getTrue, getFalse);

  // Lazy initializers adopt what the pre-paint script decided: the stored
  // preference from localStorage, and — for "system" — the resolved mode it
  // already applied to the DOM, rather than re-deriving it and risking
  // disagreement with what's painted.
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStoredTheme()
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const stored = readStoredTheme();
    if (stored !== "system") {
      return stored;
    }
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  });

  // Single writer of the `dark` class from here on. Running on every
  // resolvedTheme change also re-applies it after React's dev Strict Mode
  // remount resets `<html>` to its JSX-managed attributes (see the Next.js
  // "preventing flash before hydration" guide) — a no-op in production.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  // While following the OS, track OS preference changes live.
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      setResolvedTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setResolvedTheme(resolveTheme(next, systemPrefersDark()));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the theme still applies for this session,
      // it just won't survive a reload.
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        // Until mounted, expose the same defaults the server rendered with,
        // so consumers (e.g. the toggle's aria-checked state) hydrate
        // without mismatches; the real values land right after hydration.
        theme: mounted ? theme : "system",
        resolvedTheme: mounted ? resolvedTheme : "light",
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
