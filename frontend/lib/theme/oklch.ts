/**
 * Dependency-free OKLCH color math for the theme's contrast tests.
 *
 * `app/globals.css` declares every color as `oklch(L% C H)`. To verify the
 * palette against WCAG AA we need the actual contrast ratios, which means
 * converting OKLCH → OKLab → linear sRGB → relative luminance. The
 * conversion constants are Björn Ottosson's published OKLab matrices
 * (https://bottosson.github.io/posts/oklab/); the luminance and contrast
 * formulas are WCAG 2.x's.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1 (CSS `62.3%` parses to 0.623). */
  l: number;
  /** Chroma, 0+. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

const OKLCH_PATTERN =
  /^oklch\(\s*(\d*\.?\d+)(%?)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*\)$/;

/**
 * Parses the `oklch(L% C H)` / `oklch(L C H)` forms used in globals.css.
 * Throws on anything else (alpha channels, `none`, var() indirection) so a
 * malformed token fails the test suite loudly instead of skewing a ratio.
 */
export function parseOklch(value: string): Oklch {
  const match = OKLCH_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`not a parseable oklch() color: ${JSON.stringify(value)}`);
  }
  const [, lightness, percent, chroma, hue] = match;
  return {
    l: percent === "%" ? Number(lightness) / 100 : Number(lightness),
    c: Number(chroma),
    h: Number(hue),
  };
}

/**
 * OKLCH → linear sRGB. Channels are NOT clamped: slightly out-of-gamut
 * components (Tailwind v4's ramps exploit wide gamut) come back <0 or >1
 * and are clamped only when luminance is computed.
 */
export function oklchToLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hueRadians = (h * Math.PI) / 180;
  const a = c * Math.cos(hueRadians);
  const b = c * Math.sin(hueRadians);

  // OKLab → non-linear LMS → LMS (cube).
  const lms1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const lms2 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const lms3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lms1 - 3.3077115913 * lms2 + 0.2309699292 * lms3,
    -1.2684380046 * lms1 + 2.6097574011 * lms2 - 0.3413193965 * lms3,
    -0.0041960863 * lms1 - 0.7034186147 * lms2 + 1.707614701 * lms3,
  ];
}

/**
 * WCAG relative luminance. Linear sRGB is already gamma-decoded, so this is
 * just the Rec. 709 weighted sum, with out-of-gamut channels clamped to the
 * displayable range first (a monitor can't render past it either way).
 */
export function relativeLuminance(color: Oklch | string): number {
  const [r, g, b] = oklchToLinearSrgb(
    typeof color === "string" ? parseOklch(color) : color
  ).map((channel) => Math.min(1, Math.max(0, channel)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio, 1–21: `(L1 + 0.05) / (L2 + 0.05)` with L1 the
 * lighter of the two luminances. Symmetric in its arguments.
 */
export function contrastRatio(
  color1: Oklch | string,
  color2: Oklch | string
): number {
  const first = relativeLuminance(color1);
  const second = relativeLuminance(color2);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
