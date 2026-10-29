import { fingerprint } from "./work-plan.mjs";

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
  const missing = (task) => [...new Set([...task.capabilities,
    ...[...task.checks, ...task.criteria.flatMap((id) => milestone.criteria.find((c) => c.id === id).checks)]
      .flatMap((id) => state.config.checks[id]?.requires || [])])].filter((id) => !available.includes(id));
  return {
    milestone: milestone.id, status: state.status,
    reason: state.reason || state.planningReason || null,
    completed: Object.entries(state.states).filter(([, v]) => v.status === "done").map(([id]) => id),
    blocked: Object.entries(state.states).filter(([, v]) => v.status === "blocked").map(([id, v]) => ({ id, reason: v.reason })),
    unavailable: state.tasks.filter((t) => state.states[t.id]?.status !== "done" && missing(t).length)
      .map((t) => ({ id: t.id, missing: missing(t) })),
    human: milestone.criteria.filter((c) => c.kind === "human" && !c.done).map((c) => ({ id: c.id, description: c.description,
      ready: milestone.criteria.filter((criterion) => criterion.kind === "automated").every((criterion) => criterion.done) &&
        state.finalChecks?.codeHead === state.codeHead && state.finalChecks.results.every((result) => result.status === "passed") })),
    open: milestone.criteria.filter((c) => !c.done).map((c) => c.id),
    branch: state.branch, head: state.head,
  };
}
