---
name: realtime-systems
description: Review realtime state, multiplayer protocols, reconnect behavior, replay and latency measurements.
---

# Realtime Systems

## Rules
- RT-01: blocking for client input that can bypass authoritative validation, stale messages that mutate a later round, or cross-session data leaks.
- RT-02: check sequence/round identity, duplicate delivery, ordering, disconnect cleanup and reconnect snapshots where the protocol requires them.
- RT-03: deterministic replay must record the seed, input sequence, clock semantics and version; compare state hashes or observable invariants.
- RT-04: handle backpressure and bounded queues explicitly; flag unbounded growth with a concrete producer/consumer scenario.
- RT-05: compare performance with repository budgets and the actual measurement method. Do not substitute local transport timings for device latency.

## Examples
Bad: accept a delayed fire event from a previous round after reconnect.
Good: validate room, player, round and sequence at the authority and test delayed duplicate inputs.

## Review contract
Review and prepare recommendations only. Repository policy and the requested scope take precedence. Do not edit code, rewrite history or publish messages from this skill. Report evidence-backed findings with rule ID, severity (blocking or suggestion), location, evidence and a concrete fix. Blocking is a finding severity, not automatic merge authority. Skip duplicate mechanical findings. State unavailable checks explicitly.
