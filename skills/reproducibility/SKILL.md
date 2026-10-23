---
name: reproducibility
description: Review setup, locked dependencies, build instructions and repeatability of reported results.
---

# Reproducibility

## Rules
- REPRO-01: follow documented prerequisites and commands conceptually from a clean checkout; identify machine-specific paths, missing inputs or undeclared tools.
- REPRO-02: dependencies used in builds must have a committed lock or an explicit pinning strategy. Report a missing pin as a suggestion unless it prevents reproduction.
- REPRO-03: blocking when required source inputs or steps are absent and the advertised build cannot be reproduced; point to the exact missing dependency.
- REPRO-04: generated outputs need source/generator versions and a regeneration command. Separate nondeterministic metadata from behaviorally meaningful differences.
- REPRO-05: record OS, runtime and input fixture versions for measurements. Do not install software or run arbitrary setup scripts merely to review.

## Examples
Bad: `PLAYWRIGHT_MODULE=/my/laptop/path` is the only test setup instruction.
Good: a locked test dependency and documented browser installation, with unsupported environments explicitly listed.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
