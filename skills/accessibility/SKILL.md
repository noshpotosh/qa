---
name: accessibility
description: Accessibility standard for HTML, JSX and templates. Use when writing or reviewing markup, forms, interactive components, images or focus handling.
---

# Accessibility standard

Target: WCAG 2.2 AA. Linters (eslint-plugin-jsx-a11y, axe) catch the mechanical cases; this skill covers judgment.

## Blocking
- Every interactive element is reachable and operable by keyboard. No `onClick` on a `div`/`span` without role, `tabIndex` and key handling; prefer a real `<button>` or `<a>`.
- Every form control has a programmatic label (`<label for>`, `aria-labelledby`, or `aria-label` as last resort).
- Images: meaningful images have alt text that says what they convey; decorative images use `alt=""`.
- Focus is never removed (`outline: none`) without a visible replacement.
- Modals trap focus, close on Escape, and return focus to the trigger.
- Text contrast meets 4.5:1 (3:1 for large text and UI boundaries). See the `css-colors` skill.

## Should fix
- One `<h1>` per page; heading levels don't skip.
- Landmarks (`<main>`, `<nav>`, `<header>`) are used instead of generic divs.
- ARIA is only added when no native element does the job ("no ARIA is better than bad ARIA").
- Dynamic updates that matter (errors, toasts) are announced via `aria-live` or `role="alert"`.

## Example
- Bad: `<div class="btn" onclick="save()">Save</div>`
- Good: `<button type="button" onclick="save()">Save</button>`
