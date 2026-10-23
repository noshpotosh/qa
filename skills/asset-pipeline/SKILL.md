---
name: asset-pipeline
description: Review generated art, game assets and exports for provenance, reproducibility and runtime validity.
---

# Asset Pipeline

## Rules
- ASSET-01: connect deliverables to editable sources, generator/export versions and regeneration steps. Preserve source assets when exports change.
- ASSET-02: check configured triangle, texture, file-size, dimension and runtime format budgets. Do not invent a budget when none exists; report the gap.
- ASSET-03: blocking for demonstrated broken imports, missing required resources, or incompatible exported coordinates/materials that invalidate the intended use.
- ASSET-04: ask for reimport/runtime validation evidence; visual appearance alone does not prove export correctness.
- ASSET-05: keep provenance and third-party licensing visible. Report raw asset churn separately from authored code review size.

## Examples
Bad: replace the only editable scene with a GLB and claim export success from a thumbnail.
Good: retain the source scene, export with recorded settings, reimport in a separate process and retain a validation report.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
