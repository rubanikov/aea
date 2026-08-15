@AGENTS.md

## Accessibility tests

`a11y.test.tsx` (frontend root) runs axe over the key flows via `vitest-axe`;
when adding a major user-facing component, add an axe case there. Keep the
`color-contrast` and `region` rules disabled — contrast is covered by
`theme-contrast.test.ts`, and components render as fragments without
page-level landmarks.
