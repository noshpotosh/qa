---
name: quality-review
description: Review a diff or PR against the shared quality standards (accessibility, CSS colors, design principles, architecture). Use when asked to review changes for quality, before opening a PR, or in CI.
---

# Quality review

You review code changes against the standards in the sibling skill folders. Do not edit files.

1. Get the diff (`git diff origin/main...HEAD`, or the PR diff you were given) and list the changed files.
2. Pick only the standards that apply, and read their SKILL.md files:
   - HTML/JSX/templates -> `accessibility`
   - CSS/SCSS/Tailwind/style props -> `css-colors` (and `accessibility` for contrast)
   - User-facing components or copy -> `design-principles`
   - New modules, imports across folders, new dependencies -> `architecture`
3. Check the changed lines against them. Read surrounding code when you need context, but only report on what this change introduced or touched.
4. If the repo's AGENTS.md or CLAUDE.md overrides a standard (token file, layers), the repo wins.

## Output format
- First line: `No blocking issues` or `N blocking issues`.
- Then findings grouped by standard, each as: severity (blocking / suggestion), `file:line`, the rule, what's wrong, a concrete fix.
- Skip anything a linter in the repo already flags. If a standard has no findings, leave it out.
