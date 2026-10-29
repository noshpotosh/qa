import { fingerprint } from "./work-plan.mjs";

export function effectiveMilestone(state, snapshot) {
  const milestone = structuredClone(snapshot.milestone);
  for (const criterion of milestone.criteria) {
    const receipt = state.accepted[criterion.id];
    if (receipt && (criterion.kind !== "human" || receipt.sourceHead === state.head)) {
      criterion.done = true;
      criterion.evidence = [...new Set([...criterion.evidence, receipt.evidence])];
    }
    if (state.revalidation?.includes(criterion.id) || (criterion.kind === "human" && state.head !== state.baseline && receipt?.sourceHead !== state.head)) criterion.done = false;
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
  return {
    milestone: milestone.id, status: state.status,
    reason: state.reason || state.planningReason || null,
    completed: Object.entries(state.states).filter(([, v]) => v.status === "done").map(([id]) => id),
    blocked: Object.entries(state.states).filter(([, v]) => v.status === "blocked").map(([id, v]) => ({ id, reason: v.reason })),
    unavailable: state.tasks.filter((t) => t.capabilities.some((id) => !available.includes(id)))
      .map((t) => ({ id: t.id, missing: t.capabilities.filter((id) => !available.includes(id)) })),
    human: milestone.criteria.filter((c) => c.kind === "human" && !c.done).map((c) => ({ id: c.id, description: c.description,
      ready: milestone.criteria.filter((criterion) => criterion.kind === "automated").every((criterion) => criterion.done) })),
    open: milestone.criteria.filter((c) => !c.done).map((c) => c.id),
    branch: state.branch, head: state.head,
  };
}
