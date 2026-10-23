---
name: css-colors
description: Color standard for CSS, SCSS, Tailwind and inline styles. Use when adding or reviewing colors, themes, dark mode or contrast.
---

# CSS color standard

## Blocking
- No raw color literals (`#hex`, `rgb()`, `hsl()`, named colors) outside the token file. Use tokens, e.g. `var(--color-text-primary)`. Edit `TOKEN_FILE` below to point at yours.
- Text/background pairs meet WCAG AA contrast (4.5:1 body, 3:1 large text and UI boundaries) in both light and dark themes.
- Color is never the only way information is conveyed (errors also get an icon or text).

## Should fix
- Use semantic tokens (`--color-danger`) rather than palette tokens (`--red-500`) in components.
- New tokens are added to the token file in both themes, not defined locally.

## Config
- TOKEN_FILE: `src/styles/tokens.css` (change per repo, or override in the repo's AGENTS.md)

## Enforce mechanically too
stylelint with `color-no-hex` and `declaration-property-value-disallowed-list` for color properties, allowing only `var(--color-*)`.
