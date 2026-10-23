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

## Extended quality skills

- `skills/delivery-steward/SKILL.md`: Review commit history, PR scope and delivery evidence before implementation, committing or merging.
- `skills/test-quality/SKILL.md`: Review whether tests prove changed production behavior, including regressions and failure cases.
- `skills/security-data-integrity/SKILL.md`: Review changed trust boundaries, permissions, secrets and operations that can corrupt or lose data.
- `skills/reproducibility/SKILL.md`: Review setup, locked dependencies, build instructions and repeatability of reported results.
- `skills/evidence-quality/SKILL.md`: Review completion, performance, fidelity and readiness claims against their actual evidence.
- `skills/project-presentation/SKILL.md`: Review README, demo and project documentation for an accurate, usable first encounter.
- `skills/realtime-systems/SKILL.md`: Review realtime state, multiplayer protocols, reconnect behavior, replay and latency measurements.
- `skills/asset-pipeline/SKILL.md`: Review generated art, game assets and exports for provenance, reproducibility and runtime validity.
- `skills/hardware-validation/SKILL.md`: Review PCB, CAD, BOM and firmware changes against recorded electrical and mechanical constraints.

For this QA tooling repository, layers are CLI/workflow adapters → policy/report libraries. Libraries must not execute configured consumer commands. Run `npm test` and `npm run check` after tooling changes.
