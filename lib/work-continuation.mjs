import { fields, identifier } from './work-values.mjs';

export const outcomeMode = (config) => config.continuation === 'outcome-v1';
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
export function validatePrerequisites(milestone) {
  const list = milestone.prerequisites;
  if (!Array.isArray(list)) throw Error('Outcome continuation requires a fixed prerequisite ledger');
  const ids = new Set(), questions = new Set();
  for (const p of list) {
    fields(p, ['id', 'criteria', 'question', 'evidence', 'unlocks'], 'prerequisite');
    identifier(p.id);
    const question = p.question?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (ids.has(p.id) || questions.has(question) || !nonempty(p.question) || !nonempty(p.evidence) || !nonempty(p.unlocks) ||
        !Array.isArray(p.criteria) || !p.criteria.length || new Set(p.criteria).size !== p.criteria.length ||
        p.criteria.some((id) => !milestone.criteria.some((c) => c.id === id && c.kind === 'automated'))) throw Error('Invalid or duplicate prerequisite');
    ids.add(p.id); questions.add(question);
  }
}
export function validateTaskPrerequisites(task, milestone, config) {
  if (!outcomeMode(config)) {
    if (task.prerequisites !== undefined) throw Error('Task prerequisites require outcome continuation');
    return;
  }
  if (!Array.isArray(task.prerequisites) || new Set(task.prerequisites).size !== task.prerequisites.length ||
      (task.purpose === 'prepare' && !task.prerequisites.length) ||
      task.prerequisites.some((id) => !milestone.prerequisites.some((p) => p.id === id && p.criteria.every((c) => task.criteria.includes(c))))) {
    throw Error('Tasks must reference approved prerequisites within their criteria');
  }
}
export function blockedChecks(state, task, milestone, taskChecks) {
  const ids = [...taskChecks(task, milestone), ...(task.operations || []).map((id) => state.config.operations[id].verifier)];
  return [...new Set(ids)].filter((id) => state.config.checks[id].availability?.status === 'unavailable' || state.unavailableChecks?.[id]);
}
export function continuationEligible(state, task) {
  const resolved = state.resolvedPrerequisites || {};
  if (task.purpose === 'prepare') {
    if (task.prerequisites.every((id) => resolved[id])) return false;
    // Operations are approved acquisition steps, not arbitrary editor commands.
    return (state.preparationStreak || 0) < 3 || task.operations.length > 0;
  }
  return task.prerequisites.every((id) => resolved[id]);
}
export function validatePrerequisiteReview(state, task, review) {
  if (!outcomeMode(state.config)) return;
  const ids = review.resolvedPrerequisites;
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length ||
      ids.some((id) => task.purpose !== 'prepare' || !task.prerequisites.includes(id) || state.resolvedPrerequisites?.[id]) ||
      (ids.length && (!review.progress?.advanced || !review.progress.evidencePaths.length))) {
    throw Error('Prerequisite resolution requires new independently reviewed evidence for approved task prerequisites');
  }
}
export function recordContinuation(state, task, receipt) {
  if (!outcomeMode(state.config)) return;
  state.resolvedPrerequisites ||= {};
  for (const id of receipt.review.resolvedPrerequisites) state.resolvedPrerequisites[id] = {
    receipt: receipt.id, answer: receipt.review.progress.answer, evidencePaths: receipt.review.progress.evidencePaths,
  };
  state.preparationStreak = task.purpose === 'prepare' && !(receipt.operations || []).length ? (state.preparationStreak || 0) + 1 : 0;
}
export function continuationStatus(state) {
  if (!outcomeMode(state.config)) return {};
  return { continuation: {
    policy: state.config.continuation, prerequisites: (state.milestone.prerequisites || []).map((p) => ({ ...p, resolution: state.resolvedPrerequisites?.[p.id] || null })),
    preparationStreak: state.preparationStreak || 0, preparationLimit: 3,
    remainingAttempts: Math.max(0, state.config.tasks - (state.invocation?.attemptsStarted || 0)),
    remainingMs: state.invocation ? Math.max(0, state.invocation.deadline - (state.invocation.endedAt || Date.now())) : null,
    blockedChecks: Object.entries(state.config.checks).filter(([id, c]) => c.availability?.status === 'unavailable' || state.unavailableChecks?.[id])
      .map(([id, c]) => ({ id, ...c.availability, observed: state.unavailableChecks?.[id] || null })),
    dependencyHandoff: state.dependencyHandoff || null,
  } };
}
