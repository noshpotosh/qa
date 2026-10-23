---
name: design-principles
description: UI and product design principles. Use when building or reviewing user-facing screens, components, copy, spacing or interaction states.
---

# Design principles

Replace these with your own. Keep each principle short, concrete and checkable.

1. **Use the system first.** Reuse existing components and spacing/typography tokens before creating new ones. A new one-off component needs a reason in the PR description.
2. **Every state is designed.** Loading, empty, error and success states exist for anything that fetches or submits.
3. **Clear over clever.** Labels and buttons say what happens ("Save changes", not "OK"). Errors say what went wrong and how to fix it.
4. **Consistent spacing.** Only spacing-scale values (4/8/12/16/24/32...), never arbitrary pixel values.
5. **Responsive by default.** Works at 320px wide with no horizontal scroll.

## Review output
For each violation: the principle number, file and line, what you saw, and a suggested fix. Mark it blocking only if it breaks a principle outright; otherwise it is a suggestion.
