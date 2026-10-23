# Quality standards

This repo is the source of truth for code-quality standards. It is tool-neutral: every standard is a plain Markdown file in the Agent Skills format (`skills/<name>/SKILL.md`), so Claude Code, Codex, Grok or any other agent can read the same rules.

| Skill | Use when |
|---|---|
| `skills/accessibility/SKILL.md` | Writing or reviewing markup, forms, interactive components |
| `skills/css-colors/SKILL.md` | Adding or reviewing colors, themes, contrast |
| `skills/design-principles/SKILL.md` | Building or reviewing user-facing UI and copy |
| `skills/architecture/SKILL.md` | Adding modules, cross-folder imports, dependencies |
| `skills/quality-review/SKILL.md` | Reviewing a diff or PR against all of the above |

If your agent doesn't load skills automatically, read the relevant file above before working on matching code.
