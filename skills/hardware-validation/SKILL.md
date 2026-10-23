---
name: hardware-validation
description: Review PCB, CAD, BOM and firmware changes against recorded electrical and mechanical constraints.
---

# Hardware Validation

## Rules
- HW-01: trace changed components to BOM identifiers, footprints, pin mappings and firmware assignments; report concrete mismatches as blocking.
- HW-02: compare dimensions, tolerances, stack-up and clearances with repository requirements, using measured or tool-produced evidence.
- HW-03: distinguish ERC/DRC passing, mechanical fit checks, simulation, prototype testing and manufacturing acceptance. None substitutes automatically for another.
- HW-04: a manufacturing-ready claim needs current checks, fabrication outputs and documented unresolved warnings; missing checks mean readiness is unverified.
- HW-05: check battery/power constraints against authoritative component specifications; never invent electrical limits or certify safety from a diff.

## Examples
Bad: claim a 7 mm enclosure fits from a render without a component stack-up.
Good: provide the constrained CAD measurement, PCB thickness, component heights, tolerance allowance and prototype status.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
