---
name: delivery-steward
description: Review commit history, PR scope and delivery evidence before implementation, committing or merging.
---

# Delivery Steward

## Modes
- Plan: split the requested work into independently useful, revertible PRs before coding. Keep implementation and its tests together.
- Staged: inspect the index, not unrelated working-tree changes; prepare a descriptive commit subject and validation body.
- PR: inspect the actual base/head, description and commits; propose the final squash message.
- Audit: sample recent integrated changes and identify recurring delivery problems without rewriting history.

## Rules
- DEL-01: one coherent concern per PR. Unrelated refactors bundled with a fix are blocking findings; suggest concrete split boundaries.
- DEL-02: use authored added + deleted lines. Warn above 400 lines or 20 files; above 800 lines require a split plan or size exception. Generated files, lockfiles, binaries, captures and vendor files are separately reported, never silently discarded.
- DEL-03: a final subject must describe behavior and area; `Added v1`, `updates`, and `fix stuff` are insufficient. WIP checkpoints are allowed on topic branches.
- DEL-04: explain the problem, resulting behavior, validation actually performed and material risks. A field's presence is mechanical; its truth is a judgment.
- DEL-05: UI changes need screenshots/clips or an explicit evidence gap. Missing evidence is not proof of a defect.
- DEL-06: default to one descriptive squash commit per PR, preserving checkpoint history until integration. Repository policies override this preference.
- DEL-07: respect configured target branches. Never amend published history, alter authorship, force-push, or merge as part of a review.

## Examples
Bad: network retry fix plus a theme rewrite in `updates`.
Good: `fix(session): reconnect without replaying stale input`, with a regression test and the observed command result.
Large generated import: retain provenance, generator version and validation evidence; review source changes separately instead of demanding artificial splitting.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
