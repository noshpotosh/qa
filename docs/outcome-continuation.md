# Outcome continuation (opt-in v2)

The coordinating chat owns the requested outcome. Workers still implement one
assigned task. Install/upgrade appends a reference to
`.qa/instructions/continuation.md` once, preserving existing project guidance.
The contract asks coordinators to continue after verified subtasks and report an
explicit stopping reason. It is instruction guidance, not a guarantee of model
behavior or a background service.

## Approved contract

Set `work.continuation` to `"outcome-v1"` in a v2 configuration. Existing v1 and
non-opted-in v2 scheduling is unchanged. Default session bounds remain 120 minutes
and ten tasks; opted-in runs count **started attempts**, including failed edits,
rather than only completed tasks. Continuing retained validation is the same
attempt. Attempts and equivalent-task failure counts are never reset by resume.

Add a fixed `prerequisites` array to the milestone:

```json
{
  "id": "entry-ownership",
  "criteria": ["entry-correct"],
  "question": "Which input records become owned after recognition?",
  "evidence": "Full retained snapshot comparison and negative controls",
  "unlocks": "Implement consumption without consuming releases"
}
```

Every opted-in task has a `prerequisites` ID array. A preparation task must name
at least one approved prerequisite it will resolve. An acceptance task names the
prerequisites that must be resolved before it can run (or `[]`). Prerequisite
criteria must all belong to the task's criteria. Derived tasks cannot add ledger
entries. The ledger is part of the approval identity; changing it requires a
reviewed control change. Similar questions with different wording still require
independent scope review, not merely distinct IDs.

The independent reviewer returns `resolvedPrerequisites` separately from
`resolvedSources`. Only preparation can resolve prerequisites, with an observed
answer and retained supporting artifacts. `progress.advanced` alone does not
reset the opted-in no-progress budget. Three consecutive preparation checkpoints
trigger dependency review; only a ready implementation, executable verification or approved acquisition
task may proceed. Scope review must reject audits relabeled as implementation or
verification. Such a preparation step resets the streak only if independent
review resolves an approved prerequisite; ordinary `advanced` claims do not. An acquisition must still resolve an
unresolved ledger item, obey existing budgets and pass its verifier/review. If no
such step exists, the run reports its dependency handoff rather than manufacturing
another audit. Completed acquisition, acceptance or prerequisite-resolving implementation/verification steps reset the preparation
streak; focus changes and resumes do not.

## Closed gates and proposed changes

An acceptance check may declare:

```json
"availability": {
  "status": "unavailable",
  "reason": "Semantic admission validator is not implemented",
  "unblock": "Build and independently verify an admission validator against retained observations"
}
```

Keep its literal argv and timeout. The declared closed check is never executed or
credited as passing. It does not block preparation using separate checks. An
observed unavailable check is also retained and excluded from scheduling;
`resume --retry-unavailable` explicitly retries observed conditions within the
remaining per-task budgets. A recovered required capability also permits a retry. Declared closed gates remain closed until an approved
configuration change. Status exposes closed checks, prerequisite resolutions,
preparation streak, remaining invocation budget and dependency alternatives.

For protected observer/validator changes, build and test an isolated proposal
using existing permissions. Present the exact diff, base/configuration hashes,
validation evidence and any expanded authority. Activate only after approval of
that proposal; changed identities require renewed review. The active worker
sandbox and authority-path enforcement remain unchanged. No automatic imports,
activation, network access or publication are added by the continuation policy.

## Interruption and recovery

V2 invocation records retain start/end time, controller ownership, phase and
started attempts. Child exit events retain code, signal, observed reason and time.
A killed controller cannot record its own exit. Status inspects its local lease
and recorded children: absent processes yield `interrupted` with an **unknown**
exit cause, while foreign/missing ownership yields `ownership-unknown`. A reused
or live PID conservatively prevents recovery.

```sh
node .qa/bin/qa.mjs milestone recover-run ID
node .qa/bin/qa.mjs milestone recover-run ID --apply
node .qa/bin/qa.mjs milestone resume ID
```

The first command previews without writes. Apply only reconciles a demonstrably
abandoned running journal; it does not execute a task. It preserves budgets and
uses the existing checkpoint/validation reconciliation on explicit resume.
Uncertain acquisitions require verifier-only reconciliation. Dirty source,
unvalidated workspace edits, malformed editor paths and ambiguous ownership
remain explicit blockers. No stash, deletion, source import or blind replay occurs.
Malformed evidence paths are detected immediately after retaining the editor
result, before checks or acquisition; correct the result through reviewed manual
recovery, never by resetting the attempt.

Existing v2 journals can adopt the policy through the existing explicit
`migrate --to-version 2 --migration MAPPING.json` preview/apply workflow. The
mapping must cover every historical task and the source commit must contain only
approved controls. For continuation adoption, copy `newApproval` from the reviewed preview into the
mapping as `expectedTargetApproval`; activation refuses a different target.
Apply still requires `--approve`; receipts and retry history
survive. Historical preparation checkpoints seed the streak, but do not
retroactively resolve new prerequisites. Unrelated source edits must be reviewed
separately, not silently imported during migration.

## Evidence required for rollout

Run the full automated suite and hosted container validation. Live chat acceptance
requires one prompt to produce at least two linked, verified prerequisite results
and pursue the next useful step until completion, a demonstrated blocker or the
budget. Record actual elapsed time and stopping cause. If no runner was invoked,
label the result as chat continuation evidence only. No research checkpoint counts
as playable behavior. Do not infer the cause of the earlier THPS4 controller exit.
