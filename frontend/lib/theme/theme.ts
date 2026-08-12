/**
 * Theme preference model shared by the pre-paint script (app/layout.tsx),
 * the ThemeProvider, and the ThemeToggle.
 *
 * The stored preference is three-valued — "light" | "dark" | "system" — and
 * the *resolved* theme is the two-valued answer after consulting the OS
 * preference for "system". The `dark` class on `<html>` is the single source
 * of truth for the resolved theme; CSS never consults `prefers-color-scheme`
 * itself (see app/globals.css).
 */

export const THEME_STORAGE_KEY = "aea-theme";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

/**
 * Maps whatever was in localStorage — including `null`, an empty string, or
 * a stale/garbage value — to a valid Theme, defaulting to "system".
 */
export function parseStoredTheme(value: string | null): Theme {
  return (THEMES as readonly string[]).includes(value ?? "")
    ? (value as Theme)
    : "system";
}

/** Resolves a stored preference to the concrete light/dark mode to paint. */
export function resolveTheme(
  theme: Theme,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (theme === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return theme;
}

/**
 * Inline script injected into `<head>` by app/layout.tsx. It runs
 * synchronously during HTML parsing — before first paint — so the correct
 * theme class is on `<html>` before anything is visible.
 *
 * Mirrors `parseStoredTheme` + `resolveTheme` above. It must stay
 * self-contained (no imports, ES5-safe) because it ships as a raw string.
 * The try/catch covers storage denial (e.g. Safari private mode): on any
 * error it falls through to the OS preference rather than crashing.
 */
export const PRE_PAINT_THEME_SCRIPT = `(function(){var dark=false;try{var stored=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var theme=stored==="light"||stored==="dark"||stored==="system"?stored:"system";dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)}catch(e){try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e2){dark=false}}document.documentElement.classList.toggle("dark",dark)})()`;
