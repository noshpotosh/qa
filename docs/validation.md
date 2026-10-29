# v0.2.0 validation record

## Local milestone runner — October 29, 2026

- 74 automated cases: 72 passed, two Docker cases explicitly skipped locally.
  `npm run check`, actionlint 1.7.12 and `git diff --check` passed. Tests cover
  frozen scope, task derivation/scope rejection, dirty-baseline refusal, persisted
  attempts, unavailable check capabilities, source-mutating checks, final
  regression before human handoff, no-progress stops, isolated Git checkpoints,
  interruption recovery and adapter metadata reconciliation.
- A real macOS Codex CLI pilot passed at implementation commit `19c7560` using
  the existing account login, actual command sandbox and separate model reviews.
  A real assertion failed on the baseline; two accepted task checkpoints survived
  separate invocations and ended at one human handoff after final checks. They
  share one code commit: the second task verified retained observation evidence.
  The original checkout remained unchanged. The sanitized
  [pilot receipt](../examples/validation/local-milestone-pilot.json) records the
  candidate, checks and artifact hashes. Provider task derivation and Linux
  sandbox acceptance were not part of this live pilot.
- A committed archive from `6b07d20` was extracted and installed into a clean
  `develop`-branch consumer: preview/apply, the packaged milestone scaffold,
  disabled execution and installed plan preview passed. [Hosted validation on
  that revision](https://github.com/noshpotosh/qa/actions/runs/40934200426) passed
  normal tests/checks/workflow linting and both actual Docker smoke cases.
  Later tracker-revocation and pre-commit concurrency guards have additional
  local regression coverage and receive the same hosted checks.
- The isolated THPS4 integration's committed-baseline Tracker suite passed all
  31 tests with loopback sockets enabled. The baseline capability correctly
  rejected missing/different reviewed Unity inputs. Tracker revision 115 was
  observed locally at Milestone 3 66/66, Milestone 4 1/40; this is historical
  tracker evidence, not a new game acceptance run.
- THPS4 execution remains disabled. Its original dirty checkout was preserved.
  Tracker CAS/replay/seed behavior has controlled-transport tests; no live tracker
  write, Unity run, native capture or device acceptance was performed. A clean
  reviewed source baseline, the next approved milestone and configured producers
  are prerequisites for the THPS4 live rehearsal. Existing Actions repair/App
  acceptance remains pending separately.

## Adoption and requested repair implementation — October 28, 2026

- Local automated coverage exercises release-archive installation, non-default
  branches, managed upgrades and conflict refusal, repair authorization, stale
  feedback, unsafe paths, candidate/tree binding, three-round limits, isolated
  validation invocation, independent-review gates and exact-commit CI acceptance.
- `npm test`, `npm run check`, and actionlint 1.7.12 pass on the implementation.
  Container execution is mocked in local tests; Docker and live provider/App
  acceptance are separate checks.
- Hosted CI includes two actual container smoke cases, using a digest-pinned
  official Node image: successful isolated validation and propagation of a failing
  command. These cases are skipped locally unless `QA_DOCKER_IMAGE` is supplied.
- The first hosted container run exposed a UID mismatch: a capability-free root
  could not read the runner-owned private workspace. Validation now runs as the
  workspace owner's UID/GID with an ephemeral container home; the smoke tests
  exercise that production invocation.
- [Hosted PR CI](https://github.com/noshpotosh/qa/actions/runs/40819465755)
  passed after the UID fix: normal tests/checks/workflow linting and both actual
  Docker smoke cases succeeded. A committed archive was also built and installed
  through the real CLI locally; doctor succeeded from a consumer subdirectory.
  Provider reviews were skipped for the draft PRs and are not included in this
  passing implementation evidence.
- No repository secret names are configured in QA at inspection. A live issue
  repair, existing-PR repair, App-triggered CI and repeated progress updates
  therefore remain pending. No consumer repair automation was enabled, no new
  release published, and no merge/protection settings changed.

## Earlier baseline

Validated on October 23, 2026. This record distinguishes implementation checks from live model acceptance.

## Passed

- 18 local automated tests: real staged Git diffs, rename/binary/deletion parsing, configuration, exact PR-size thresholds, generated accounting, evidence fields, report validation, safe initialization, stale publication and deduplication.
- All fourteen skills pass the skill-creator validator. JavaScript/configuration validation and actionlint pass.
- [QA release PR CI and policy](https://github.com/noshpotosh/qa/pull/6) passed on the implementation revision; final documentation updates run the same checks again.
- [QA PR workflow](https://github.com/noshpotosh/qa/actions/runs/39910787916) ran twice and retained one comment (ID 6358807565). Missing credentials were reported as unavailable.
- [Manual audit](https://github.com/noshpotosh/qa/actions/runs/39911196013) and [second audit](https://github.com/noshpotosh/qa/actions/runs/39911430810) succeeded as workflow executions and retained one [tracking issue](https://github.com/noshpotosh/qa/issues/5). Both model audits were unavailable; they did not assess the code.
- [Site pilot](https://github.com/noshpotosh/site/pull/1) passed the reusable QA workflow.
- [Controlla application CI](https://github.com/noshpotosh/controlla/actions/runs/39910967386) passed on the initial adoption commit; its QA collection, policy and publishing also passed. Subsequent immutable-pin updates trigger the same application CI again.

## Pending or intentionally deferred

- A live Codex PR assessment, live Codex audit and Claude smoke assessment need owner-managed API secrets. No provider keys were configured in the three pilots at inspection time. Workflow success without a key is not agent acceptance.
- Fork isolation was inspected in the workflow conditions; malformed/stale result handling has mocked coverage. No external fork PR was created for a live end-to-end test.
- Consumer adoption PRs remain unmerged. Enable their required policy check after adoption lands, preserving existing checks. Do not require an absent workflow.
- The site remote main contains only index.html; the local navigation/physics suite belongs to unpublished work and was not copied. Add its application CI after that source lands. Browser validation additionally needs reproducible Playwright setup.
- Other project profiles are adoption guidance, not completed migrations or hardware/asset certifications.
