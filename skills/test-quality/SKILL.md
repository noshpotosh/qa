---
name: test-quality
description: Review whether tests prove changed production behavior, including regressions and failure cases.
---

# Test Quality

## Rules
- TEST-01: for a bug fix, identify a test that fails on the previous behavior and passes with the fix. Missing evidence is a suggestion unless a critical path has no meaningful protection.
- TEST-02: blocking when a test bypasses the changed production path yet claims to validate it, or mocks away the defect under test.
- TEST-03: check observable outputs and invariants, including malformed input, cleanup and retry behavior where relevant. Do not demand every conceivable case.
- TEST-04: flag uncontrolled time, randomness, network dependencies and order dependence; prefer injected clocks/seeds or bounded integration fixtures.
- TEST-05: distinguish tests inspected from tests executed. Require actual command/CI evidence before saying tests pass. Avoid coverage quotas and tests that only repeat implementation details.

## Examples
Bad: duplicate the parsing function inside a test and assert its result.
Good: call the exported parser with the regression input and assert the externally visible result and failure behavior.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
