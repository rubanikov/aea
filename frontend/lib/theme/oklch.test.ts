import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  oklchToLinearSrgb,
  parseOklch,
  relativeLuminance,
} from "./oklch";

/**
 * Anchor values come from independent sources of truth, never from running
 * this module:
 *   - white/black luminances and the 21:1 / 1:1 ratios are defined by WCAG;
 *   - the achromatic case follows from OKLab's construction (for C = 0 all
 *     three LMS components equal L³ and each sRGB matrix row sums to 1, so
 *     `oklch(50% 0 0)` is exactly linear gray 0.125);
 *   - pure red's OKLab coordinates (L 0.628, a 0.225, b 0.126 → C 0.2577,
 *     H 29.23°) are published in Björn Ottosson's OKLab announcement.
 */

describe("parseOklch", () => {
  it("parses the percent-lightness form used in globals.css", () => {
    const parsed = parseOklch("oklch(98.4% 0.003 247.858)");
    expect(parsed.l).toBeCloseTo(0.984, 10); // 98.4 / 100 carries float noise
    expect(parsed.c).toBe(0.003);
    expect(parsed.h).toBe(247.858);
  });

  it("parses the unitless-lightness form", () => {
    expect(parseOklch("oklch(0.623 0.214 259.815)")).toEqual({
      l: 0.623,
      c: 0.214,
      h: 259.815,
    });
  });

  it("parses integer components and surrounding whitespace", () => {
    expect(parseOklch("  oklch( 100% 0 0 )  ")).toEqual({ l: 1, c: 0, h: 0 });
  });

  it.each([
    "oklch(50% 0.1)", // missing hue
    "oklch(50% 0.1 20 / 0.5)", // alpha not supported
    "var(--neutral-900)", // unresolved indirection
    "#ffffff",
  ])("rejects %s", (value) => {
    expect(() => parseOklch(value)).toThrow(/not a parseable oklch/);
  });
});

describe("oklchToLinearSrgb", () => {
  it("maps pure red's published OKLab coordinates back to linear (1, 0, 0)", () => {
    const [r, g, b] = oklchToLinearSrgb(parseOklch("oklch(62.796% 0.25768 29.234)"));
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it("maps achromatic L to linear gray L³ on every channel", () => {
    for (const channel of oklchToLinearSrgb(parseOklch("oklch(50% 0 0)"))) {
      expect(channel).toBeCloseTo(0.125, 4);
    }
  });
});

describe("relativeLuminance", () => {
  it("is 1 for white and 0 for black", () => {
    expect(relativeLuminance("oklch(100% 0 0)")).toBeCloseTo(1, 5);
    expect(relativeLuminance("oklch(0% 0 0)")).toBeCloseTo(0, 5);
  });

  it("is 0.2126 for pure red (the Rec. 709 red weight)", () => {
    expect(relativeLuminance("oklch(62.796% 0.25768 29.234)")).toBeCloseTo(
      0.2126,
      3
    );
  });
});

describe("contrastRatio", () => {
  const white = "oklch(100% 0 0)";
  const black = "oklch(0% 0 0)";

  it("is 21:1 for white on black", () => {
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
  });

  it("is 1:1 for a color against itself", () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(contrastRatio("oklch(62.3% 0.214 259.815)", "oklch(62.3% 0.214 259.815)")).toBeCloseTo(1, 5);
  });

  it("is symmetric in its arguments", () => {
    const gray = "oklch(55.4% 0.046 257.417)";
    expect(contrastRatio(white, gray)).toBeCloseTo(contrastRatio(gray, white), 10);
  });

  it("is 6:1 for white on mid-gray (luminance 0.125 by OKLab's construction)", () => {
    // (1 + 0.05) / (0.125 + 0.05) = 6 exactly.
    expect(contrastRatio(white, "oklch(50% 0 0)")).toBeCloseTo(6, 3);
  });

  it("is 3.5:1 for mid-gray on black", () => {
    // (0.125 + 0.05) / (0 + 0.05) = 3.5 exactly.
    expect(contrastRatio("oklch(50% 0 0)", black)).toBeCloseTo(3.5, 3);
  });
});
