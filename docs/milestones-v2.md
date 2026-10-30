# V2 milestone execution

V2 is opt-in. Existing v1 contracts and journals keep their execution behavior.
Set `work.version: 2`, the plan's `version: 2`, and each milestone's `version: 2`.
Every task supplies `purpose` (`prepare` or `accept`), a concrete `question`, and
an `operations` array (empty when no acquisition is needed).

Preparation runs its own approved checks. It never credits its parent criteria.
Acceptance additionally runs the criteria's checks before independent review.
The planner can prepare missing evidence while final checks are unavailable;
it cannot invent commands, change controls, or reset exhausted attempts. Reviewer
progress must answer the task question with observed artifacts. File changes
alone do not reset the three-task no-progress limit.

## Capabilities and preflight

Capabilities represent executable tooling, not completed research. Each v2 probe
must declare `probe: true`, promising non-destructive observation. Probes execute
with a read-only workspace; scratch space is separate. A trusted network probe
must itself avoid external mutations. Dependencies are probed before dependents.

`qa milestone preflight ID` checks approved probes in an isolated copy of the
committed source. It does not invoke a model, perform acquisition, or credit
acceptance. Probe output should identify the manifests/locations examined and
separate missing files, unreachable services and invalid evidence. The runner
records these diagnostics and refreshes probes after accepted checkpoints.

## Acquisition operations

Place stateful acquisition in `work.operations`, not `work.checks`:

```json
{
  "capture": {
    "argv": ["python3", "Tools/acquire.py"],
    "timeoutSeconds": 900,
    "network": true,
    "inputs": ["Research/capture-plan.json"],
    "outputs": [".qa-output/capture.json", ".qa-output/raw.jsonl"],
    "requires": ["owned-session"],
    "verifier": "verify-capture",
    "reuse": "inputs"
  }
}
```

The verifier is an existing approved check and must not rewrite the acquired
outputs. Declare every source input affecting acquisition. External dependencies
must be declared resources or identity-checked by the verifier. Operation keys
include inputs, resources, commands and protected controls. Reuse is opt-in;
`fresh` is the default. An unchanged retained candidate can finish validation
without repeating its same-attempt acquisition even in fresh mode.

Operations run after the editor prepares its source inputs and before task
validation. Analysis of newly acquired results belongs in a dependent task.
The controller retains complete output bytes and revalidates them before reuse.
Changing relevant inputs invalidates reuse; unrelated analysis edits do not.

An interrupted or failed acquisition remains uncertain. It is never repeated
silently. When complete output was retained, use
`qa milestone reconcile-operation ID --operation RECEIPT_ID` to run only its
verifier, then resume the retained candidate. Missing complete output requires
manual investigation; the runner provides no command to discard that uncertainty.

## Migrating an existing run

Stop at a clean checkpoint. Commit the reviewed v2 contract and control changes
on the original source checkout, without unrelated source changes. Do not edit
its journal. Keep criterion IDs, descriptions, scope and allowed paths unchanged.
The tracker adapter envelope remains version 1; its returned milestone is v2.

Prepare an explicit mapping JSON outside the source checkout:

```json
{
  "version": 2,
  "expectedApproval": "CURRENT_JOURNAL_APPROVAL",
  "expectedSourceHead": "COMMITTED_V2_SOURCE_HEAD",
  "expectedWorkHead": "CURRENT_OWNED_WORKTREE_HEAD",
  "tasks": ["Replace with every existing task object, including its v2 purpose, question and operations"]
}
```

The example task string is deliberately not executable. Map all journal tasks,
including derived and completed tasks. Preserve IDs, kinds, criteria and
dependencies; mapped tasks present in the committed plan must match it exactly.

```sh
node .qa/bin/qa.mjs milestone migrate ID --to-version 2 --migration /tmp/mapping.json
node .qa/bin/qa.mjs milestone migrate ID --to-version 2 --migration /tmp/mapping.json --apply --approve
node .qa/bin/qa.mjs milestone resume ID
```

Preview writes nothing. Apply locks the run, backs up the journal, checkpoints
exact control changes in the owned worktree, and records the old/new approvals.
Attempts, equivalent-task failure counts, receipts and tracker bindings survive.
Changed criterion checks require revalidation; human acceptance becomes stale
when the evidence generation changes. A pending migration is reconciled by
repeating its approved apply; concurrent edits are refused rather than overwritten.

`status` separates accepted criteria, reviewed intermediate progress, capability
changes, acquisition executions/reuse and operator interventions. These are
observations about the run, not a percentage estimate of remaining game work.
