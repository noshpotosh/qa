# THPS4 tracker bridge: integration candidate

The generic runner has no tracker, Unity, native-capture or game-specific code.
`consumer/` contains the repository-specific adapter, check wrappers, frozen
criterion bindings and configuration for a THPS4 pilot. It is disabled by
default. Copy/merge these files into a reviewed THPS4 integration branch, install
the pinned QA runtime, then append this once to `Tracker/seed.mjs`:

```js
import { applyQaAcceptance } from "./qa-acceptance.mjs";
applyQaAcceptance(seed);
```

Do not bulk-stage the original checkout to make the runner's clean-baseline
check pass. The inspected THPS4 checkout has substantial unrelated uncommitted
work. The integration candidate is prepared from committed source separately.

## Scope and current evidence

The included manifest maps all 66 original Grinds & Slides criteria to stable
IDs. It preserves labels, denominators and the frozen static-rail exclusions.
At tracker revision 115 on October 29, 2026, that milestone was recorded at
66/66; Manuals & Lines was staged at 1/40. These are tracker observations, not
newly executed game acceptance. Do not reopen Milestone 3 or automatically
approve Milestone 4. Review the next goal, evidence and exclusions before
freezing new bindings and enabling execution.

`.qa-tracker.json` is generated inspection data: criterion bindings and SHA-256
identities for authored Unity inputs. It contains no recovered game assets or
disc contents. The baseline capability deliberately refuses the old committed
source when those reviewed inputs have not landed. It is a prerequisite check,
not a new-source detector: after approved implementation starts, the runner
tracks its own commits. Refresh this manifest only as an explicit scope/baseline
review, never to silence a mismatch.

## Tracker writes and seed progress

The adapter reads the existing local tracker endpoint and targets original
criterion labels. It clones the latest state, performs `PUT` with `If-Match`,
retries a stale revision at most five times and retains unrelated human edits.
It uses the tracker's existing backup-producing API rather than editing its
ignored persisted JSON. Operation markers deduplicate replay after interruption.
A criterion is credited only by a scoped passing independent review, or a
separate explicit human attestation.

Accepted IDs also update `Tracker/qa-acceptance.json` inside the owned worktree.
The controller commits that mirror separately; the one-time seed hook reapplies
those IDs without creating another hand-authored progress module for every run.
Tests exercise stale-response retry, preservation, deduplication and the seed
hook using a controlled transport. A live tracker write has not been performed.

## Local toolchain and remaining pilot work

The wrapper targets Unity 6000.3.10f1 on macOS. It runs actual Tracker tests and
Unity EditMode/PlayMode suites in the owned workspace. Gates retain at least
306 EditMode passes, 51 PlayMode passes and at most three PlayMode skips.
Existing comparison reports are archived before checks; new comparison bytes
are retained and previous bytes restored in that owned workspace. Fresh XML,
logs and archive receipts live in ignored `.qa-output/`. A failing test is a
failed validation; missing tooling/license/timeouts are incomplete outcomes.

Original disc/recovered inputs are read-only resources. Recovered assets are
copied to private writable Unity imports in the owned workspace. The wrapper
does not launch or advance original-game sessions. Native capture and signed
device build/install are explicit unavailable capabilities until owned-session
and matching-build producers are configured. Hands-on Backbone/performance
acceptance remains human. No Unity, native, device or tracker-write pilot is
claimed by this integration.

Before enabling: land/review the current source baseline, reconcile the next
approved milestone, configure the required capture/build producers and local
Unity licensing, then run one implementation task and one evidence task in
separate invocations. Verify tracker backup/CAS, retained evidence, seed replay,
concurrent-human-edit refusal and a final human handoff. Do not call THPS4
autonomous delivery operational until that live rehearsal passes.
