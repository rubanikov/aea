# AEA theme redesign — mockups v2 (final token values)

High-fidelity static mockups of the two locked structures (Google Classic Grid calendar, Square-style booking stepper with the approved **Provider → Service → Date & Time → Confirm** order), in both themes:

- `calendar-light.html` / `calendar-dark.html` — provider week grid
- `booking-light.html` / `booking-dark.html` — booking wizard at step 3 (Date & time)

All colors below are the exact values used in the files, ready to port into `frontend/app/globals.css`.

## Light theme

| Token | Value |
|---|---|
| `--background` | `oklch(98.5% 0.004 250)` |
| `--foreground` | `oklch(21% 0.02 260)` |
| `--card` / `--popover` | `oklch(100% 0 0)` |
| `--border` | `oklch(91% 0.01 255)` |
| `--border-strong` | `oklch(85% 0.014 255)` |
| `--muted` | `oklch(96% 0.006 255)` |
| `--muted-foreground` | `oklch(50% 0.02 260)` |
| `--primary` | `oklch(56% 0.16 266)` |
| `--primary-hover` | `oklch(50% 0.17 266)` |
| `--primary-active` | `oklch(44% 0.17 266)` |
| `--primary-foreground` | `oklch(100% 0 0)` |
| `--primary-tint` | `oklch(95.5% 0.02 266)` |
| `--primary-tint-border` | `oklch(88% 0.05 266)` |
| `--secondary` (teal, borders/fills) | `oklch(58% 0.10 200)` |
| `--secondary-text` **(new token — see deviations)** | `oklch(46% 0.10 200)` |
| `--secondary-tint` | `oklch(96% 0.02 200)` |
| `--success` | `oklch(52% 0.11 152)` |
| `--warning` | `oklch(75% 0.14 80)` |
| `--danger` | `oklch(55% 0.19 25)` |
| `--info` | `oklch(58% 0.09 210)` |
| card shadow | `0 1px 2px oklch(21% 0.02 260 / .06), 0 2px 8px oklch(21% 0.02 260 / .05)` |
| hatch stripes (blocked time) | `oklch(94.5% 0.005 255)` / `oklch(97.5% 0.004 255)` |

## Dark theme (separately tuned, not an invert)

| Token | Value |
|---|---|
| `--background` | `oklch(17% 0.015 260)` |
| `--foreground` | `oklch(94% 0.005 260)` |
| `--card` | `oklch(21% 0.016 260)` |
| `--popover` | `oklch(25% 0.018 262)` |
| `--surface-raised` **(new token)** | `oklch(26% 0.018 262)` |
| `--hover` (hover/pressed surface) | `oklch(28% 0.02 262)` |
| `--border` | `oklch(30% 0.015 260)` |
| `--border-strong` | `oklch(36% 0.02 260)` |
| `--muted` | `oklch(25% 0.015 260)` |
| `--muted-foreground` | `oklch(68% 0.01 260)` |
| `--primary` | `oklch(72% 0.14 266)` |
| `--primary-hover` | `oklch(78% 0.13 266)` |
| `--primary-active` | `oklch(82% 0.12 266)` |
| `--primary-foreground` | `oklch(16% 0.02 260)` (dark text on light-indigo fill) |
| `--primary-tint` | `oklch(24% 0.045 266)` |
| `--primary-tint-border` | `oklch(38% 0.08 266)` |
| `--secondary` | `oklch(72% 0.09 200)` |
| `--secondary-text` | `oklch(72% 0.09 200)` (same as `--secondary`; light enough on dark surfaces) |
| `--secondary-tint` | `oklch(24% 0.03 200)` |
| `--success` | `oklch(70% 0.13 152)` |
| `--warning` | `oklch(78% 0.13 80)` |
| `--danger` | `oklch(68% 0.17 25)` |
| `--info` | `oklch(72% 0.09 210)` |
| card shadow | `none` — dark elevation is expressed purely through the lightness steps 17 → 21 → 25/26 → 28 |
| hatch stripes (blocked time) | `oklch(23.5% 0.014 260)` / `oklch(21.5% 0.015 260)` (slightly lighter than card) |

## Tag palette (`--tag-1` … `--tag-8`)

Retained unchanged from the current `globals.css` (both light and dark blocks). Their discipline already matches the new system: pale tinted backgrounds + mid-chroma borders + deep readable foregrounds in light; dark tinted backgrounds + brighter borders + near-white foregrounds in dark. No retune needed.

## Deviations from the anchor palette

1. **Added `--secondary-text: oklch(46% 0.10 200)` for light theme.** The anchor teal `oklch(58% 0.10 200)` measures only **4.08:1** as text on white — below AA for small text. It stays as the border/fill/UI color (UI components need only 3:1), and the deeper 46% variant (**6.57:1** on white) is used wherever teal is rendered as text (open-slot labels, completed-step labels, availability legends). In dark theme both tokens are the same value.
2. **Added `--surface-raised` (dark: `oklch(26% 0.018 262)`)** for buttons/segmented controls/chips so raised interactive elements get their own elevation step between popover (25%) and hover (28%). In light theme this is just `--card` (white).
3. **`--primary-tint` dark nudged from the anchor's 26% to 24% L** so the today-column wash stays clearly below the card tone and event blocks keep their contrast against it.
4. Everything else (backgrounds, foregrounds, borders, primary ramp, status hues) is exactly the anchor values — they all passed AA as-is.

## Contrast verification (WCAG AA, computed)

| Pairing | Ratio |
|---|---|
| Light `--foreground` on `--background` | 16.98:1 |
| Light `--muted-foreground` on `--background` | 5.75:1 |
| Light white on `--primary` (button) | 4.79:1 |
| Light white on `--primary-hover` | 6.23:1 |
| Light `--secondary-text` (46%) on white | 6.57:1 |
| Light `--danger` on `--background` | 5.12:1 |
| Dark `--foreground` on `--background` | 16.04:1 |
| Dark `--foreground` on `--card` | 14.86:1 |
| Dark `--muted-foreground` on `--card` | 6.15:1 |
| Dark `--primary-foreground` on `--primary` (button) | 7.71:1 |
| Dark `--primary` as text/link on `--background` | 7.59:1 |
| Dark `--secondary` on `--card` | 7.41:1 |
| Dark `--danger` on `--card` | 5.69:1 |
