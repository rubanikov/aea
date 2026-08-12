import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

/**
 * Guards the destructive-action styling chain end to end:
 *
 *   Button variant="destructive"
 *     → `bg-destructive` utility
 *     → `--color-destructive: var(--destructive)`   (@theme inline mapping)
 *     → `--destructive: var(--danger)`              (alias, :root AND .dark)
 *     → `--danger: var(--danger-…)`                 (Layer A ramp)
 *
 * jsdom doesn't resolve var() chains from an external stylesheet, so the
 * rendered half is asserted via the applied class and the CSS half via the
 * token declarations in globals.css (same technique as theme-contrast.test.ts).
 */
describe("Button destructive variant", () => {
  it("applies the bg-destructive utility and exposes its variant", () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.className).toContain("bg-destructive");
    expect(button).toHaveAttribute("data-variant", "destructive");
  });

  describe("--destructive → --danger token chain in globals.css", () => {
    const css = readFileSync(
      join(process.cwd(), "app", "globals.css"),
      "utf8"
    ).replaceAll(/\/\*[\s\S]*?\*\//g, "");
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)]
      .map(([, body]) => body)
      .join("\n");
    const darkBlocks = [...css.matchAll(/\.dark\s*\{([^}]*)\}/g)]
      .map(([, body]) => body)
      .join("\n");
    const themeBlock = css.match(/@theme inline\s*\{([^}]*)\}/)?.[1] ?? "";

    it("aliases --destructive to --danger in both light and dark mode", () => {
      expect(rootBlocks).toMatch(/--destructive:\s*var\(--danger\)/);
      expect(darkBlocks).toMatch(/--destructive:\s*var\(--danger\)/);
      expect(rootBlocks).toMatch(
        /--destructive-foreground:\s*var\(--danger-foreground\)/
      );
      expect(darkBlocks).toMatch(
        /--destructive-foreground:\s*var\(--danger-foreground\)/
      );
    });

    it("resolves --danger onto the Layer A ramp in both modes", () => {
      expect(rootBlocks).toMatch(/--danger:\s*var\(--danger-\d+\)/);
      expect(darkBlocks).toMatch(/--danger:\s*var\(--danger-\d+\)/);
    });

    it("maps bg-destructive through the @theme inline block", () => {
      expect(themeBlock).toMatch(
        /--color-destructive:\s*var\(--destructive\)/
      );
    });
  });
});
