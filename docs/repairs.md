# Requested repairs

Repairs are optional. Existing reviews and audits remain read-only. Live provider
and GitHub App acceptance is pending; unit tests and workflow linting do not
establish operational acceptance.

## Enable in a consumer

Run the released CLI's `init --repairs` preview, then repeat with `--apply`.
This proposes `.github/workflows/qa-repair.yml` without changing existing CI.
Merge the configuration and caller into the default branch before dispatching.
The source repository's reusable workflow is not itself a consumer caller.

Enable `repair` explicitly in `.qa.json` on the integration branch:

```json
{
  "repair": {
    "enabled": true,
    "validationCommands": ["npm ci", "npm test", "npm run check"],
    "requiredChecks": ["validate"],
    "validationImage": "node@sha256:REPLACE_WITH_64_HEX_DIGEST"
  }
}
```

Use your actual commands and exact existing check names. Replace the deliberately
invalid image placeholder with a verified image digest. Enabled repairs require
explicit commands, checks and a digest-pinned image. Choose an image containing
your project's tools; no implicit install/setup command runs. Commands execute
sequentially in one container with only the candidate directory mounted, no
capabilities, no inherited credentials and a 15-minute timeout. Network access is
available for dependency setup. Hosted Ubuntu runners provide Docker.

Configure owner-managed repository secrets:

- `OPENAI_API_KEY` for the Codex repair proposer.
- `QA_APP_ID` and `QA_APP_PRIVATE_KEY` for an App installed only on intended
  consumers, with Contents, Pull requests and Issues write permissions, and
  Checks and Actions read permissions. Only the
  publisher mints a repository-scoped installation token.
- `ANTHROPIC_API_KEY` if the independent reviewer uses Claude.

No credentials or branch-protection settings are changed by setup. Human merge
authority remains unchanged. App pushes use ordinary fast-forward updates.

## Request a repair

In Actions, run **Requested QA repair** from the default branch. The requester
must be a human with repository write/maintain/admin permission. Supply:

- `kind: issue`, `number: N`, empty `sources`: captures the current open issue's
  title/body and opens a draft PR on a separate `codex/repair-issue-*` branch.
- `kind: pr`, `number: N`, explicit `sources`: appends commits to the open
  same-repository PR. Select `comment:ID` for a human conversation comment,
  `review:ID` for a human inline review at the current commit, or
  `qa:COMMENT_ID:INDEX` for a structured QA finding. Separate selectors with
  commas or whitespace. Indexes start at zero, policy findings first, then agent
  findings. QA reports must match the exact PR base and head.

Refresh older QA reports without structured selectors first. Source and reports
are untrusted material; comments never independently authorize repairs. Fork
writes and changes to workflows, Git settings, agent instructions or QA control
configuration require manual handling. Text replacements are limited to 50 files
and 1 MiB of JSON.

One dispatch owns its round budget; reruns are refused. Dispatch a new request
after inspecting a blocked result. Requests serialize by target. Private source,
snapshots and validation logs are retained in artifacts for 14 days.

One request runs up to three rounds. Each round proposes replacements, validates
them in isolation, and runs a fresh independent review. Only a passing review
that verifies all selected sources and stays within scope can publish a candidate.
The publisher then waits up to 15 minutes for the configured CI checks on that
exact commit. Failed validation, unresolved review findings or failed CI feed
the next round; unavailable evidence, scope expansion, conflicts, concurrent
changes and repeated unpublished candidates stop the request. Three unsuccessful
rounds exhaust the budget. Text changes are retained with attempt evidence so
later rounds can repair unpublished candidates without losing earlier fixes.

`completed` requires validation, policy, independent review and selected CI to
pass. Draft issue PRs stay draft; humans review and merge. A failed later round
does not remove earlier published commits. Progress updates one App-owned
comment per request and retains the full versioned record in artifacts.

## Pilot acceptance

Before broad adoption, observe an issue repair opening a draft PR, an existing-PR
repair appending a commit, CI running on the App commit, a failed attempt feeding
another round, and one progress comment updating without duplicates. Also verify
missing-provider, unauthorized-request, fork, stale-source and concurrent-push
handling. Record actual runs and commits before declaring the loop operational.
