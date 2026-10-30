# Resumable local milestones

Approve one bounded milestone, then let the local CLI choose ready tasks,
implement them, run configured checks and request a fresh independent review.
It keeps reviewed commits on an isolated branch and returns a progress report.
The operator owns scope, hands-on acceptance and merge decisions.

This is separate from Actions requested repairs. It uses the existing Codex CLI
login; no GitHub App or new provider API key is required for local execution.
The portable contract and scheduler are provider-neutral. The first local
executor uses Codex; existing Codex/Claude PR reviews remain available.

## Set up an existing repository

Use Node.js 22+, Git, and a logged-in Codex CLI supporting `--ignore-user-config`,
`--strict-config`, `--output-schema` and named filesystem permission profiles.
The live macOS pilot used Codex `0.165.0-alpha.1.2`. Other versions and Linux
isolation need their own live acceptance; doctor/run fail closed on missing
controls. Existing project `.codex/config.toml` requires a vetted executor
profile; this version rejects it rather than accepting its overrides.

From a versioned release extracted outside the consumer repository:

```sh
node /path/to/qa/bin/qa.mjs init --milestones --profile web
node /path/to/qa/bin/qa.mjs init --milestones --profile web --apply
```

Review preserved-file conflicts. Edit `.qa-work.json` to name the milestone,
describe its goal and exclusions, list allowed paths and observable acceptance
criteria. Configure `work.checks` in `.qa.json`, then set `work.enabled` to true.
The installer proposes `npm test` when a test script exists. That proposal does
not establish test quality or approve a placeholder milestone. Commit the
reviewed configuration and current source before running; dirty baselines are
refused without staging or discarding their files.

```sh
node .qa/bin/qa.mjs doctor --milestones
node .qa/bin/qa.mjs milestone plan milestone-1
node .qa/bin/qa.mjs milestone run milestone-1 --approve
node .qa/bin/qa.mjs milestone status milestone-1
node .qa/bin/qa.mjs milestone resume milestone-1
```

After repairing unavailable execution or validation infrastructure, use
`milestone resume ID --retry-unavailable` to retry only tasks stopped by reported
unavailability.
Prior attempts and equivalent-task failure limits are retained; exhausted,
scope-rejected and ordinary validation-failed tasks are not reset.
Completed editor output is checkpointed before validation. A controller buffer
failure can resume checks/review of that exact candidate without another edit
invocation. For an initial-version `spawnSync git ENOBUFS` failure, use
`milestone recover-validation ID --task TASK`, then `milestone resume ID`.
Recovery requires an unambiguous original editor result and unchanged source;
it retains all attempts and does not reopen rejected validation or scope.

`plan` reads the contract without invoking the model. Empty task lists are valid:
the runner derives small tasks inside the frozen scope and submits the proposed
plan to a separate scope reviewer. Explicit tasks may declare dependencies,
priorities, checks and local capabilities. Missing capabilities leave dependent
work blocked while independent work continues. A capability required by a check
is also required by its tasks. `requiredCapabilities` gates the whole run.

Default invocation budgets are 120 minutes and ten completed tasks; failed
attempts persist, with at most three attempts per equivalent task. Resume does
not reset failures by renaming tasks. Three tasks with no changed source,
retained artifact or resolved criterion stop for no progress. The operator must
explicitly start each resumed invocation; this is not a background daemon.
Configured check outputs do not themselves count as project progress, even if
their timestamps or timings change. New source, resolved criteria or new
editor-declared project evidence are required. Invalid planning proposals are
capped at three for the same planning context; reviewed progress or changed
capabilities can refresh that context. Previous planning failures remain in the
journal, and per-task editing attempts are never reset. Missing capabilities
are reported for unassigned criteria as well as existing tasks.

## Checks and input resources

Commands use literal argv arrays, never shell strings. Merge settings like these
into the existing configuration:

```json
{
  "work": {
    "enabled": true,
    "checks": {
      "tests": { "argv": ["npm", "test"], "timeoutSeconds": 900 }
    }
  }
}
```

Commands execute only in workflow/CLI adapters; policy/report libraries never
execute consumer code. Exact argv tokens `{workspace}`, `{sourceRoot}`,
`{baseline}` and `{output}` expand in the command adapter. `network` defaults to
false. Use `outputs` for fresh regular evidence files under ignored `.qa-output/`;
declared outputs must exist for successful checks. Evidence is hashed and retained
in the journal. Checks that change source cannot produce an accepted checkpoint.
The final suite must pass before completion or a human acceptance handoff.

Declare originals in `resources` with an `id`, `source` and relative `target`.
Relative sources resolve from the original repository. The runner provisions
read-only aliases, hashes originals and checks their identity. Mutable Unity
imports, captures and reports belong in the owned workspace. Declare only
necessary `readRoots` for installed toolchains. Commands may have separate
`readRoots`; these do not grant the editor that access. Never declare credential
directories as inputs.

The controller protects Git/configuration, instructions, the milestone contract,
declared controls and repository files explicitly named in command argv. Workers
and checks have stripped credential environments and no publishing credentials.
Provider transport uses the CLI's existing login outside the command sandbox.
Model invocations ignore user configuration, disable apps/MCP and use a fresh
conversation for every review. No sandbox bypass is used. Review receives the
controller's actual staged patch and observed check records.
The controller snapshots repository instructions (respecting directory-level
`AGENTS.override.md`) into the prompt and disables CLI automatic instruction
discovery with [`project_doc_max_bytes = 0`](https://learn.chatgpt.com/docs/config-file/config-reference). Instruction files remain denied to
worker writes, including newly created override files.

## Resume, acceptance and publishing

Owned worktrees live under `.qa-worktrees/`; the original checkout stays on its
baseline. The versioned journal lives under the Git common directory's
`qa-milestones/ID/`, outside the worker's write access. It records approvals,
attempts, source/input identities, receipts, process leases and prepared commits.
Interrupted commits and adapter updates reconcile on resume. A blocked dirty
candidate is retained in a quarantined worktree while independent work continues.
Do not delete journals, move worktrees or edit their Git state during a run.
Source/configuration changes or concurrent branch changes stop reconciliation.

Human criteria are never credited by a model. Once automated criteria and final
checks pass, record an observation tied to the exact build and source:

```json
{
  "version": 1,
  "criterionId": "device",
  "sourceHead": "FULL_REVIEWED_HEAD_SHA",
  "buildId": "unique-installed-build-id",
  "observation": "What the operator actually observed on the named device"
}
```

```sh
node .qa/bin/qa.mjs milestone accept milestone-1 --criterion device --evidence /path/to/observation.json
node .qa/bin/qa.mjs milestone resume milestone-1
node .qa/bin/qa.mjs milestone publish milestone-1
```

Later code/evidence generations invalidate earlier human receipts. Publishing
uses authenticated `gh` plus normal Git push, creates or updates one draft PR,
and never merges. Publication does not establish hosted CI success. `publication`
defaults to `manual`; `run-end` and `milestone-end` are opt-in. Budget-paused or
interrupted runs do not automatically publish. Local progress survives unavailable
publishing.

## Custom trackers

The default file-backed plan is immutable; verified progress lives in the
journal. A custom `work.adapter` is trusted, reviewed code invoked from the
original baseline, with JSON stdin/stdout and an explicit timeout. `read` returns
`{version:1,revision:string,milestone,context?}`. `record` receives the task,
independent-review receipt, operation ID, expected revision, source commit and
owned workspace. `attest` receives a human receipt. Writes must be revision
checked, narrow, backed up where appropriate and idempotent by operation ID.
Subsequent reads must reflect recorded acceptance. A revoked tracker criterion
stops reconciliation instead of being overwritten by a historical receipt.

An adapter returns `{version:1,revision:string,checkpointFiles?:string[]}`. Only
declared `adapterOutputs` may change in the owned workspace; the controller
commits them as separate prepared metadata operations. These outputs cannot be
execution authority. An external tracker update and a Git commit are not one
transaction: idempotent replay reconciles the gap. The
[THPS4 integration example](../examples/thps4/README.md) demonstrates this
boundary without putting tracker or Unity logic in the generic scheduler.
