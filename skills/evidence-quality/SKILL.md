---
name: evidence-quality
description: Review completion, performance, fidelity and readiness claims against their actual evidence.
---

# Evidence Quality

## Rules
- EVID-01: label claims as observed, author-attested, target, assumption or unverified. A checkbox is an attestation, not independent execution evidence.
- EVID-02: blocking for a materially false verified/passing claim contradicted by the attached result. Missing evidence alone should be described as unverified.
- EVID-03: measurements need workload, environment, method and sample count; latency claims must identify measured endpoints.
- EVID-04: distinguish native reference captures, reconstructed behavior and inferred semantics. Preserve failed experiments relevant to the conclusion.
- EVID-05: a screenshot shows one state; it does not establish responsiveness, keyboard behavior, performance or complete acceptance.

## Examples
Bad: call a Node MessageChannel benchmark phone-to-screen latency.
Good: report it as local message transport timing and separately mark device motion-to-photon latency unmeasured.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
