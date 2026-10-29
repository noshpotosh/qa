# v0.2.0 validation record

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
