import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/theme/oklch";

/**
 * Guards the app against the "invisible text" class of bug: a surface that
 * paints its own background while letting its text colour fall through from
 * the document.
 *
 * The document's colour is a theme token; the surfaces in this app are fixed
 * light-palette Tailwind utilities (`bg-white`, `bg-gray-50`, …). Whenever the
 * token and the surface disagree — which is exactly what happened when
 * `globals.css` still carried the Next.js starter's `prefers-color-scheme:
 * dark` override — every inheriting run of text on those surfaces renders
 * near-white on near-white and disappears.
 *
 * Two invariants keep that from coming back:
 *   1. the theme system is class-driven and complete — every semantic token
 *      is declared in both the `:root` and `.dark` blocks, `color-scheme`
 *      follows the same class, and CSS never flips on `prefers-color-scheme`
 *      behind the components' backs (only the pre-paint script and the
 *      ThemeProvider consult the OS preference, in JS);
 *   2. background and foreground are declared together on the same element,
 *      so a surface stays legible no matter what it's nested in.
 */

/** Vitest runs with its config root — the `frontend` package — as cwd. */
const FRONTEND_ROOT = process.cwd();

/** Utilities with no variant prefix (`hover:`, `disabled:`, …) and no alpha
 * suffix (`bg-black/50` is a scrim, not a surface). */
const LIGHT_SURFACE =
  /(?<![\w:-])bg-(?:white|(?:gray|red|green|amber|blue|yellow)-(?:50|100|200))(?![\w/-])/;
const DARK_SURFACE =
  /(?<![\w:-])bg-(?:black|(?:gray|red|green|amber|blue|yellow)-(?:600|700|800|900))(?![\w/-])/;
const TEXT_COLOR =
  /(?<![\w:-])text-(?:white|black|(?:gray|red|green|amber|blue|yellow)-\d{2,3})(?![\w-])/g;
/** Foregrounds light enough to vanish on a light surface. */
const LIGHT_TEXT = new Set(["text-white"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

/**
 * Every static string literal in the file. Class lists here are plain literals
 * — sometimes a whole `className` value, sometimes one branch of a ternary —
 * and each is returned separately, because each is separately what lands on a
 * single element.
 *
 * Hand-scanned rather than regex-matched: these files are full of prose
 * comments, and a lone apostrophe in one ("the provider's timezone") makes
 * naive quote-pairing swallow the rest of the file.
 */
function classListLiterals(source: string): string[] {
  const literals: string[] = [];
  let current: string | null = null;
  let delimiter = "";
  const templateDepth: number[] = [];
  let i = 0;

  function push() {
    if (current !== null) {
      literals.push(current);
    }
    current = null;
  }

  while (i < source.length) {
    const char = source[i];

    if (current !== null) {
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === delimiter) {
        push();
        i += 1;
        continue;
      }
      // A `${…}` hole ends this static chunk; the expression inside is scanned
      // as code, so nested literals come back as their own class lists.
      if (delimiter === "`" && char === "$" && source[i + 1] === "{") {
        push();
        templateDepth.push(0);
        i += 2;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      current = "";
      delimiter = char;
      i += 1;
      continue;
    }
    if (templateDepth.length > 0) {
      if (char === "{") {
        templateDepth[templateDepth.length - 1] += 1;
      } else if (char === "}") {
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          current = "";
          delimiter = "`";
          i += 1;
          continue;
        }
        templateDepth[templateDepth.length - 1] -= 1;
      }
    }
    i += 1;
  }

  return literals;
}

function textColorsIn(classList: string): string[] {
  return classList.match(TEXT_COLOR) ?? [];
}

interface Violation {
  file: string;
  classList: string;
  reason: string;
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const dir of ["app", "components"]) {
    for (const file of sourceFiles(join(FRONTEND_ROOT, dir))) {
      const relative = file.slice(FRONTEND_ROOT.length).replaceAll("\\", "/");

      for (const classList of classListLiterals(readFileSync(file, "utf8"))) {
        const colors = textColorsIn(classList);

        if (LIGHT_SURFACE.test(classList)) {
          const readable = colors.filter((color) => !LIGHT_TEXT.has(color));
          if (readable.length === 0) {
            violations.push({
              file: relative,
              classList,
              reason:
                "light background with no dark text colour — its text inherits the document foreground",
            });
          }
        }

        if (DARK_SURFACE.test(classList) && colors.every((color) => !LIGHT_TEXT.has(color))) {
          violations.push({
            file: relative,
            classList,
            reason:
              "dark background with no light text colour — its text inherits the document foreground",
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Every semantic (Layer B) token in `globals.css`. Each must be declared in
 * both the `:root` (light) and `.dark` blocks: a token that exists in only
 * one mode silently falls back to the other mode's value when the class
 * flips, which is exactly how half-themed dark modes happen.
 */
const SEMANTIC_TOKENS = [
  // Surfaces & text
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--border-strong",
  "--input",
  "--ring",
  // Brand
  "--primary",
  "--primary-foreground",
  "--primary-hover",
  "--primary-active",
  "--primary-subtle",
  "--primary-subtle-foreground",
  "--link",
  // Status families
  ...["success", "warning", "danger", "info"].flatMap((status) => [
    `--${status}`,
    `--${status}-foreground`,
    `--${status}-soft`,
    `--${status}-soft-foreground`,
    `--${status}-border`,
    `--${status}-text`,
  ]),
  // shadcn/ui aliases
  "--destructive",
  "--destructive-foreground",
  // Calendar
  "--grid-line",
  "--grid-line-strong",
  "--grid-hour-label",
  "--grid-today-bg",
  "--slot-open-bg",
  "--slot-open-border",
  "--slot-busy-bg",
  "--slot-selected-bg",
  "--slot-selected-foreground",
  "--status-confirmed-border",
  "--status-completed-bg",
  "--status-completed-foreground",
  "--status-cancelled-bg",
  "--status-cancelled-foreground",
  "--blocked-hatch-fg",
  "--blocked-hatch-bg",
];

describe("theme tokens", () => {
  const css = readFileSync(
    join(FRONTEND_ROOT, "app", "globals.css"),
    "utf8"
  ).replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)]
    .map(([, body]) => body)
    .join("\n");
  const darkBlocks = [...css.matchAll(/\.dark\s*\{([^}]*)\}/g)]
    .map(([, body]) => body)
    .join("\n");

  it("declares every semantic token in both :root and .dark", () => {
    const missing = SEMANTIC_TOKENS.flatMap((token) => [
      ...(rootBlocks.includes(`${token}:`) ? [] : [`${token} missing in :root`]),
      ...(darkBlocks.includes(`${token}:`) ? [] : [`${token} missing in .dark`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("declares color-scheme in both modes", () => {
    expect(rootBlocks).toMatch(/color-scheme:\s*light/);
    expect(darkBlocks).toMatch(/color-scheme:\s*dark/);
  });

  it("never consults the OS preference from CSS — the .dark class is the single source of truth", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });
});

describe("theme contrast", () => {

  it("declares a foreground colour on every element that paints a background", () => {
    expect(findViolations()).toEqual([]);
  });
});

/**
 * The heuristics above only prove a foreground is *declared*; this block
 * proves the declared palette is *legible*. It resolves each semantic token
 * through its `var()` chain down to the raw `oklch(…)` literal in Layer A,
 * converts it (lib/theme/oklch.ts), and asserts every foreground/background
 * pair the app actually composes meets WCAG AA for normal text (≥ 4.5:1) —
 * in both the light (`:root`) and dark (`.dark`) palettes.
 */
describe("WCAG AA token contrast", () => {
  const css = readFileSync(
    join(FRONTEND_ROOT, "app", "globals.css"),
    "utf8"
  ).replaceAll(/\/\*[\s\S]*?\*\//g, "");

  /** `--token: value;` declarations inside every block matching `selector`. */
  function declarations(selector: RegExp): Map<string, string> {
    const map = new Map<string, string>();
    for (const [, body] of css.matchAll(selector)) {
      for (const [, name, value] of body.matchAll(
        /(--[\w-]+)\s*:\s*([^;]+);/g
      )) {
        map.set(name, value.trim());
      }
    }
    return map;
  }

  const rootDeclarations = declarations(/:root\s*\{([^}]*)\}/g);
  const darkDeclarations = declarations(/\.dark\s*\{([^}]*)\}/g);

  /**
   * Resolves a token to its raw `oklch(…)` literal the way the cascade
   * does: `.dark` declarations win in dark mode, with `:root` as the
   * fallback (Layer A ramps are declared only in `:root`).
   */
  function resolve(token: string, mode: "light" | "dark"): string {
    let value: string | undefined = token;
    const seen = new Set<string>();
    while (value !== undefined && value.startsWith("--")) {
      if (seen.has(value)) {
        throw new Error(`circular var() chain at ${value}`);
      }
      seen.add(value);
      const declared: string | undefined =
        mode === "dark"
          ? (darkDeclarations.get(value) ?? rootDeclarations.get(value))
          : rootDeclarations.get(value);
      value = declared?.match(/^var\((--[\w-]+)\)$/)?.[1] ?? declared;
    }
    if (value === undefined) {
      throw new Error(`token ${token} is not declared for ${mode} mode`);
    }
    return value;
  }

  /** Every [foreground, background] pairing the UI composes. */
  const PAIRS: [string, string][] = [
    ["--foreground", "--background"],
    ["--card-foreground", "--card"],
    ["--popover-foreground", "--popover"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    ["--primary-foreground", "--primary"],
    ["--primary-subtle-foreground", "--primary-subtle"],
    ["--link", "--background"],
    ["--link", "--card"],
    ["--destructive-foreground", "--destructive"],
    ...["success", "warning", "danger", "info"].flatMap(
      (status): [string, string][] => [
        [`--${status}-foreground`, `--${status}`],
        [`--${status}-soft-foreground`, `--${status}-soft`],
        [`--${status}-text`, `--background`],
        [`--${status}-text`, `--card`],
      ]
    ),
    ["--grid-hour-label", "--background"],
    ["--slot-selected-foreground", "--slot-selected-bg"],
    ["--status-completed-foreground", "--status-completed-bg"],
    ["--status-cancelled-foreground", "--status-cancelled-bg"],
  ];

  it.each(["light", "dark"] as const)(
    "every token pair meets 4.5:1 in %s mode",
    (mode) => {
      const failures = PAIRS.flatMap(([foreground, background]) => {
        const ratio = contrastRatio(
          resolve(foreground, mode),
          resolve(background, mode)
        );
        return ratio >= 4.5
          ? []
          : [`${foreground} on ${background}: ${ratio.toFixed(2)}:1`];
      });
      expect(failures).toEqual([]);
    }
  );
});

/**
 * Files already migrated to semantic tokens must not regress to literal
 * Tailwind palette utilities (`bg-white`, `text-gray-600`, `border-red-300`,
 * …); a literal palette class renders one fixed colour in both themes, which
 * is exactly what the token system exists to prevent. As further screens are
 * migrated, add them here.
 */
const TOKEN_MIGRATED_FILES = [
  "app/access-denied/page.tsx",
  "app/admin/page.tsx",
  "app/login/page.tsx",
  "app/page.tsx",
  "app/settings/page.tsx",
  "components/audit/AuditLogFilters.tsx",
  "components/audit/AuditLogPagination.tsx",
  "components/audit/AuditLogTable.tsx",
  "components/audit/AuditLogViewer.tsx",
  "components/auth/AuthPageClient.tsx",
  "components/auth/LoginForm.tsx",
  "components/auth/RegisterForm.tsx",
  "components/auth/SessionMismatchNotice.tsx",
  "components/forms/PasswordField.tsx",
  "components/forms/TextField.tsx",
  "components/settings/DeleteAccountSection.tsx",
  "components/settings/PasswordForm.tsx",
  "components/settings/ProfileForm.tsx",
];

/** A colour utility naming a literal palette colour, with or without a
 * variant prefix (`hover:bg-gray-50`) or opacity suffix (`bg-black/50`). */
const HARDCODED_PALETTE =
  /(?<![\w-])(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|placeholder|caret|decoration|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?![\w-])/g;

describe("token migration", () => {
  it.each(TOKEN_MIGRATED_FILES)(
    "%s uses only semantic colour tokens",
    (relative) => {
      const source = readFileSync(join(FRONTEND_ROOT, relative), "utf8");
      const offenders = classListLiterals(source).flatMap(
        (classList) => classList.match(HARDCODED_PALETTE) ?? []
      );
      expect(offenders).toEqual([]);
    }
  );
});
