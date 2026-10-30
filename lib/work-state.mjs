import { continuationStatus } from './work-continuation.mjs';
import { fingerprint, taskCapabilities } from "./work-plan.mjs";

export function effectiveMilestone(state, snapshot) {
  const milestone = structuredClone(snapshot.milestone);
  for (const criterion of milestone.criteria) {
    const receipt = state.accepted[criterion.id];
    const currentCode = state.codeHead || state.head;
    const currentHuman = receipt && (receipt.codeIdentity || receipt.sourceHead) === currentCode && (receipt.generation || 0) === (state.generation || 0);
    if (receipt && (criterion.kind !== "human" || currentHuman)) {
      criterion.done = true;
      criterion.evidence = [...new Set([...criterion.evidence, receipt.evidence])];
    }
    if (state.revalidation?.includes(criterion.id) || (criterion.kind === "human" && (currentCode !== state.baseline || state.generation) && !currentHuman)) criterion.done = false;
  }
  return milestone;
}
export function startAttempt(state, task) {
  const previous = state.states[task.id] || { attempts: 0 };
  if (previous.attempts >= state.config.attempts) throw Error("Task attempts exhausted");
  const key = fingerprint({ criteria: [...task.criteria].sort(), checks: [...task.checks].sort(), kind: task.kind });
  if ((state.failureKeys[key] || 0) >= state.config.attempts) throw Error("Equivalent task exhausted its retry budget");
  state.states[task.id] = { ...previous, status: "running", attempts: previous.attempts + 1, key };
  return state.states[task.id];
}
export function failAttempt(state, task, reason, { terminal = false } = {}) {
  const attempt = state.states[task.id];
  state.failureKeys[attempt.key] = (state.failureKeys[attempt.key] || 0) + 1;
  attempt.reason = reason;
  attempt.status = terminal || attempt.attempts >= state.config.attempts ? "blocked" : "ready";
}
export function handoff(state, milestone, available) {
  const missing = (task) => taskCapabilities(task, milestone, state.config).filter((id) => !available.includes(id));
  return {
    ...continuationStatus(state),
    ...(milestone.version === 2 ? { focus: state.focus || [], diagnostics: diagnostics(state, milestone, available), progress: {
      acceptedCriteria: milestone.criteria.filter((c) => c.done).map((c) => c.id),
      intermediate: Object.entries(state.receipts).filter(([, r]) => r.review.progress?.advanced)
        .map(([task, r]) => ({ task, question: state.tasks.find((t) => t.id === task)?.question, ...r.review.progress })),
      capabilityChanges: state.events.filter((e) => e.type === "capabilities-probed" && (e.added.length || e.lost.length)),
      elapsedMs: state.elapsedMs || 0,
      interventions: state.events.filter((e) => ["invocation-resumed", "unavailable-retry-requested", "migrated", "human-accepted"].includes(e.type)),
      operations: Object.values(state.operationReceipts || {}).map(({ id, status, executions, reuses }) => ({ id, status, executions, reuses })),
    } } : {}),
    milestone: milestone.id, status: state.status,
    reason: state.reason || state.planningReason || null,
    completed: Object.entries(state.states).filter(([, v]) => v.status === "done").map(([id]) => id),
    blocked: Object.entries(state.states).filter(([, v]) => v.status === "blocked").map(([id, v]) => ({ id, reason: v.reason })),
    unavailable: state.tasks.filter((t) => state.states[t.id]?.status !== "done" && missing(t).length)
      .map((t) => ({ id: t.id, missing: missing(t) })),
    unavailableCriteria: milestone.criteria.filter((c) => !c.done && c.kind === "automated").map((c) => ({
      id: c.id, description: c.description, missing: [...new Set(c.checks.flatMap((id) => state.config.checks[id]?.requires || []))].filter((id) => !available.includes(id)),
    })).filter((c) => c.missing.length),
    human: milestone.criteria.filter((c) => c.kind === "human" && !c.done).map((c) => ({ id: c.id, description: c.description,
      ready: milestone.criteria.filter((criterion) => criterion.kind === "automated").every((criterion) => criterion.done) &&
        state.finalChecks?.codeHead === state.codeHead && state.finalChecks.results.every((result) => result.status === "passed") })),
    open: milestone.criteria.filter((c) => !c.done).map((c) => c.id),
    branch: state.branch, head: state.head,
  };
}
export function diagnostics(state, milestone, available) {
  const records = [];
  for (const [id, probe] of Object.entries(state.probes || {})) if (!available.includes(id)) records.push({
    category: "missing-tooling", capability: id, affected: state.tasks.filter((t) => taskCapabilities(t, milestone, state.config).includes(id)).map((t) => t.id),
    observed: probe.diagnostic, actor: "agent", nextAction: "Inspect the configured probe and declared locations; pursue available prerequisites. Changed authority requires human approval.",
  });
  for (const [id, attempt] of Object.entries(state.states)) if (attempt.status === "blocked") records.push({
    category: attempt.attempts >= state.config.attempts || (state.failureKeys[attempt.key] || 0) >= state.config.attempts ? "exhausted-budget" : attempt.unavailable ? "unavailable-execution" : "validation-failed",
    affected: [id], observed: attempt.reason, actor: "human", nextAction: "Inspect retained evidence; do not reset retry counts or weaken acceptance.",
  });
  for (const c of milestone.criteria.filter((c) => !c.done)) records.push({ category: c.kind === "human" ? "human-decision" : "incomplete-evidence",
    affected: [c.id], observed: c.description, actor: c.kind === "human" ? "human" : "agent",
    nextAction: c.kind === "human" ? "Await automated gates, then attest the exact build." : "Plan bounded preparation using available approved tools, then run criterion acceptance checks." });
  if (state.reason) records.push({ category: state.status === "budget-paused" ? "exhausted-budget" : "run-stopped", affected: [milestone.id], observed: state.reason, actor: "human", nextAction: "Inspect the recorded stop before resuming." });
  return records;
}
export function preparePlanningContext(state, criteria) {
  const evidence = Object.values(state.receipts).flatMap((receipt) => receipt.progressArtifacts ?? receipt.artifacts ?? [])
    .map(({ path, sha256 }) => `${path}:${sha256}`).sort();
  const key = fingerprint({ head: state.codeHead || state.head, criteria: criteria.map((c) => c.id).sort(), available: state.available || [], evidence });
  if (state.planContext !== key && (state.planContext || state.checkpoints.length)) {
    if (state.planFailures) (state.planningEpisodes ||= []).push({ context: state.planContext || "legacy", failures: state.planFailures, reason: state.planningReason });
    state.planFailures = 0;state.planningReason = null;
  }
  state.planContext = key;
}
