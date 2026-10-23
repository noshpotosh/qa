# Migration, security and release

## From v0.1.0

The new workflow defaults to Codex. Set `agent: claude` to preserve the old provider. Both PR and audit workflows now accept either provider. `qa_ref` is required and must be a full commit SHA; pin `uses:` to the same SHA. This is an intentional pre-1.0 interface change. The old v0.1.0 tag remains intact.

Use init's dry run to prepare `.qa.json`, a workflow caller, an AGENTS addition and a PR template. Merge proposals into existing files; preserve branch conventions, templates and validation jobs. Add a provider secret only through the repository owner's credential process. Release tags are discoverability aids; generated callers use immutable SHAs.

## Trust boundaries

- Collection uses trusted QA code and PR-base configuration. Consumer source is read as data; no consumer build/install/test command executes in a model job.
- Model jobs have a read-only repository token, no persisted checkout credentials, no publishing permission, and a read-only tool/sandbox policy. Codex retains the action's drop-sudo strategy. Claude receives only Read/Grep/Glob tools. Provider keys exist only in eligible model jobs.
- Fork/non-collaborator PRs receive mechanical checks only. Do not switch to pull_request_target to expose secrets to fork code.
- Publishing runs on a separate runner using trusted QA code, validates model output, and escapes HTML/mentions in rendered report fields. PR publishing checks the head SHA, base SHA and metadata update timestamp before writing. Concurrency cancels superseded runs.
- One bot-owned marker comment/issue is updated. Human comments with matching markers are not overwritten. Audits target the configured integration branch, resolved to an exact SHA before review.
- Artifacts expire after 14 days. They contain diffs and review context; private repository access rules apply. Do not put secrets into diffs or evidence attachments.

Actions themselves remain version-tagged in this baseline and can be pinned to verified action SHAs by consumer policy. This system is not a security certification. Missing model output is unavailable, not a pass; an unavailable agent review does not fail the objective policy gate.

## Rollout checklist

Run local checks and workflow linting, then verify actual PR CI and comment updates. Confirm missing-key and fork behavior before requiring the policy job. Preserve existing branch rules and required checks. Never enable a required job on a consumer's target branch before the workflow has landed there.

Owner-managed prerequisites: add OPENAI_API_KEY for a live Codex PR review and manual audit; add ANTHROPIC_API_KEY for a Claude compatibility smoke test. Keep live acceptance pending until observed. Consumer adoption PRs remain unmerged until the owner chooses to integrate them.
