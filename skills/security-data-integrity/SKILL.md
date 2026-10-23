---
name: security-data-integrity
description: Review changed trust boundaries, permissions, secrets and operations that can corrupt or lose data.
---

# Security Data Integrity

## Rules
- SEC-01: blocking for an identified authorization bypass, unvalidated path traversal, secret exposure, or unsafe command construction. Trace untrusted input to the consequential operation.
- SEC-02: destructive writes must preserve intended data on error. Examine atomic replacement, concurrent updates, empty bodies, cancellation and rollback semantics.
- SEC-03: check least-privilege boundaries between untrusted code, repository credentials, model credentials and publishing jobs.
- SEC-04: distinguish a confirmed defect from a hypothetical attack. Give the concrete input, affected path and consequence; uncertain concerns are suggestions.
- SEC-05: do not execute exploits against external services, print secrets, or run destructive validation during a review.

## Examples
Bad: truncate the destination before validating a request body.
Good: validate the body, write a temporary file, and atomically replace only after successful completion, with concurrency behavior documented.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
