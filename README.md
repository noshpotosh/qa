# qa

My code-quality standards in one place, written once and usable by Claude Code, Codex, Grok or any other coding agent.

The standards themselves stay specific (exact rules, examples, thresholds). Only the *packaging* is tool-neutral: every standard is a plain Markdown file in the open Agent Skills format, `skills/<name>/SKILL.md`, which is a folder plus a Markdown file with a short `name`/`description` header. Agents that understand skills load them automatically. Agents that don't can simply be told to read the file.

## Layout
- `AGENTS.md`: index of the standards, for any agent
- `skills/<name>/SKILL.md`: the standards (accessibility, css-colors, design-principles, architecture) and the reviewer (quality-review)
- `.claude-plugin/`: thin wrapper so Claude Code can install this repo as a plugin
- `.github/workflows/quality-review.yml`: reusable PR review, choose `agent: claude | codex`
- `.github/workflows/quality-audit.yml`: reusable weekly whole-repo audit
- `examples/consumer-repo/`: what to copy into each repo

## Using it from each tool

| Tool | Local use | In CI |
|---|---|---|
| Claude Code | `/plugin marketplace add noshpotosh/qa`, then `/plugin install qa@qa`. Skills load automatically; run `/quality-review` before a PR. | `agent: claude` |
| Codex | Make the skills visible to Codex (for example, symlink `.qa/skills` into the repo's `.agents/skills`), or rely on AGENTS.md pointing at them. | `agent: codex` |
| Grok / anything else | AGENTS.md tells the agent where the standards are. Ask it to "follow skills/quality-review/SKILL.md". | Add a step in `quality-review.yml` (placeholder is marked). |

The simplest cross-tool setup in a consuming repo is a git submodule: `git submodule add https://github.com/noshpotosh/qa .qa`.
After that, every agent can read `.qa/skills/...` and stay pinned to a known version.

## Adopting it in a repo
1. Copy `examples/consumer-repo/AGENTS.md` (and `CLAUDE.md`, which just imports AGENTS.md) into the repo and fill in the overrides.
2. Copy `examples/consumer-repo/.github/workflows/quality.yml` and choose the agent.
3. Add the matching secret (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). For Claude, also install the Claude GitHub app.

This repo must be public, or the consuming repos need Actions access to it (Settings > Actions > General > Access).

## Per-repo overrides
Values that differ per repo, such as the token file path or layer names, go in that repo's AGENTS.md. The reviewer skill treats the repo's own file as the final word.

## Pair with linters
Agents handle judgment; linters handle rules. Recommended alongside: eslint-plugin-jsx-a11y or axe, stylelint (no raw colors), dependency-cruiser or import-linter (layers and cycles).

## Versioning
Consumers use `@main` by default. Tag releases (`v1`) and pin to a tag once the standards settle, so a wording change can't suddenly change every repo's reviews.
