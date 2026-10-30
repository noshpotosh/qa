import { selectReady, validateProposal, taskChecks, taskCapabilities } from '../lib/work-plan.mjs';
import { outcomeMode, blockedChecks, continuationEligible } from '../lib/work-continuation.mjs';
import { preparePlanningContext } from '../lib/work-state.mjs';

function pendingPlanning(state, milestone) {
  return milestone.criteria.filter((c) => !c.done && c.kind === "automated" &&
    (!state.focus?.length || state.focus.includes(c.id)) &&
    !state.tasks.some((t) => t.criteria.includes(c.id) && (!state.focus?.length || t.criteria.every((id) => state.focus.includes(id))) && (!outcomeMode(state.config) || continuationEligible(state, t) && !blockedChecks(state, t, milestone, taskChecks).length) && state.states[t.id]?.status !== "done" &&
      (milestone.version !== 2 || taskCapabilities(t, milestone, state.config).every((id) => state.available.includes(id)))));
}
export function readyTasks(state, milestone, tasks, available) {
  const ready = selectReady(milestone, tasks, state.states, available);
  return outcomeMode(state.config) ? ready.sort((a, b) => Number(a.purpose === 'prepare') - Number(b.purpose === 'prepare')) : ready;
}

export async function deriveTasks(executor, state, milestone) {
  const criteria = pendingPlanning(state, milestone).filter((c) => milestone.version === 2 || c.checks.every((id) =>
    (state.config.checks[id]?.requires || []).every((capability) => (state.available || []).includes(capability))));
  if (!criteria.length) return false;
  preparePlanningContext(state, criteria);
  if ((state.planFailures || 0) >= 3) return false;
  try {
    const proposal = await executor.plan({ ...milestone, criteria }, state.tasks, { states: state.states, finalFailure: state.finalFailure, source: state.sourceContext, continuation: { policy: state.config.continuation, preparationStreak: state.preparationStreak || 0, resolvedPrerequisites: state.resolvedPrerequisites || {}, unavailableChecks: state.unavailableChecks || {} } });
    const tasks = validateProposal(proposal, milestone, state.config, state.tasks);
    if (tasks.some((t) => t.criteria.some((id) => !criteria.some((c) => c.id === id)))) throw Error("Proposal retries blocked or unrelated criteria");
    if (outcomeMode(state.config) && !selectReady(milestone, tasks.filter((t) => continuationEligible(state, t) && !blockedChecks(state, t, milestone, taskChecks).length).map((t) => ({ ...t, capabilities: taskCapabilities(t, milestone, state.config) })), state.states, state.available || []).length) throw Error('Proposal adds no executable step in the approved dependency path');
    const review = await executor.reviewPlan(milestone, tasks);
    if (review.scope !== "within-request" || review.report.status !== "passed") throw Error("Derived plan did not pass independent scope review");
    state.tasks.push(...tasks);
    state.planningReason = null;
    return true;
  } catch (e) {
    state.planFailures = (state.planFailures || 0) + 1;
    state.planningReason = e.message;
    return false;
  }
}
