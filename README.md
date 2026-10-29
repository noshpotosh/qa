# qa

Shared quality standards for code, delivery, evidence, assets and hardware. Fourteen tool-neutral skills work with Codex, Claude Code, or any agent that reads Markdown. Deterministic checks enforce PR structure; agents provide evidence-backed advisory reviews.

## Start locally

Requires Node.js 22 or newer and Git. No package installation is needed.

```sh
# Download a published version's qa-VERSION.tar.gz and matching .sha256
# from https://github.com/noshpotosh/qa/releases into a temporary directory.
# Verify the checksum, then extract it outside your repository:
shasum -a 256 -c qa-VERSION.tar.gz.sha256
tar -xzf qa-VERSION.tar.gz
# From your existing repository, run the extracted CLI:
node /path/to/extracted/qa/bin/qa.mjs init --profile web
# Inspect the preview, then repeat with --apply.
node .qa/bin/qa.mjs doctor --remote # optional; requires authenticated gh
node .qa/bin/qa.mjs check --staged
node .qa/bin/qa.mjs check --base origin/main --head HEAD --pr /path/to/pr.json
```

`init` defaults to a dry run, detects the Git root and integration branch, and derives immutable workflow pins from the release. It installs an ignored local `.qa` runtime without a nested Git checkout. It appends one marked instruction block and preserves existing templates and CI. Ambiguous detection requires `--profile` or `--branch`. Confirm the displayed settings with `--apply`; conflicts include proposed content for manual reconciliation. Intact managed callers can be upgraded; edited runtime files and unrelated `.qa` directories are refused. Existing clone/submodule installations must be moved aside explicitly before switching to managed installation.

Release archives are built from committed source with `node scripts/package-release.mjs /tmp/qa-release`. The tag workflow tests, packages and publishes archives on future version tags; no new release is implied by these instructions. Review the pinned source before running its tools. `doctor` separates local validity from credentials and historical live review evidence; `--remote` reads GitHub through your existing `gh` login and never retrieves secret values.

`pr.json` contains `title`, `body`, and `base` (the target branch name). A local check without PR metadata explicitly skips PR-field checks. Exit codes: 0 passed, 1 policy failed, 2 unavailable/configuration error. Validation commands are recorded, never automatically executed by the CLI or model reviewer.

## Skills and profiles

[AGENTS.md](AGENTS.md) indexes all skills. `quality-review` coordinates plan, staged, PR and audit modes. The new skills cover delivery discipline, tests, security/data integrity, reproducibility, evidence, presentation, realtime systems, asset pipelines and hardware validation.

Profiles: `qa-tooling`, `web`, `static-site`, `realtime-game`, `research`, `assets`, `hardware`. See [configuration](docs/configuration.md) and [adoption inventory](docs/adoption.md).

- Codex: expose individual skill folders under `.agents/skills`, or ask it to read `.qa/skills/quality-review/SKILL.md`.
- Claude Code: `/plugin marketplace add noshpotosh/qa`, `/plugin install qa@qa`, then `/qa:quality-review`.
- Other agents: read the same skill directly. Grok CI remains an extension point until a CLI is selected.

## CI adoption

The initializer generates a reusable workflow caller with matching immutable SHAs for the workflow and standards. Copy or merge its proposed configuration and PR template. Existing CI still runs the project's tests/builds; QA does not duplicate those jobs.

Add `OPENAI_API_KEY` to the consumer repository for Codex, or select `agent: claude` and add `ANTHROPIC_API_KEY`. This implementation supplies Claude the job's read-only GitHub token; it does not require a separately installed Claude GitHub App. Secrets are owner-managed.

PRs receive a mechanical policy check and one updated review comment. Weekly audits update one tracking issue on Mondays at 14:00 UTC; manual dispatch runs an audit. Untrusted fork PRs get mechanical checks and artifacts without provider secrets or comment writes. Missing credentials, invalid output and timeouts are reported as unavailable reviews.

After validating a pilot, require the observed `QA / policy` check name in branch protection, preserving existing checks. Agent judgments remain advisory. Optional [requested repairs](docs/repairs.md) use a separate maintainer-dispatched workflow and GitHub App; basic adoption never enables code changes. No automatic merges, force pushes or historical cleanup are performed.

## Development and release

```sh
npm test
npm run check
actionlint .github/workflows/*.yml
```

See [migration and security](docs/migration.md), [behavioral evaluation](docs/evaluation.md), and the [validation record](docs/validation.md). The repository's initial release is `v0.1.0`; the `0.2.0` implementation adds nine skills, structured reports, a CLI, provider parity and safer publishing. Live provider acceptance is tracked separately from mechanical CI.
