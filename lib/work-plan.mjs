import crypto from "node:crypto";
import { matches } from "./glob.mjs";

export const fingerprint = (value) => crypto.createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
}
export function fields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) {
    throw Error(`Invalid ${label}`);
  }
}
export function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) || Object.hasOwn(Object.prototype, value) || value === "prototype") {
    throw Error(`Invalid identifier: ${value}`);
  }
  return value;
}
export function relativePath(value) {
  if (typeof value !== "string" || !value || /[\\\x00-\x1f\x7f]/.test(value) ||
      value.split("/").some((p) => !p || p === "." || p === "..")) {
    throw Error("Expected a safe repository-relative path");
  }
  return value;
}
const text = (value) => typeof value === "string" && value.trim();
const names = (value) => Array.isArray(value) && value.every((v) => {
  identifier(v); return true;
}) && new Set(value).size === value.length;
function unique(items, label) {
  if (!Array.isArray(items)) throw Error(`Expected ${label} array`);
  const ids = items.map((item) => identifier(item.id));
  if (new Set(ids).size !== ids.length) throw Error(`Duplicate ${label} IDs`);
}
export function validateTask(task, milestone) {
  fields(task, ["id", "title", "kind", "criteria", "dependencies", "capabilities", "checks", "priority", ...(milestone.version === 2 ? ["purpose", "operations", "question"] : [])], "task");
  if (milestone.version === 2 && (!["prepare", "accept"].includes(task.purpose) || !names(task.operations) || !text(task.question))) throw Error("V2 tasks require purpose, operations and a progress question");
  identifier(task.id);
  if (!text(task.title) || !["implementation", "research", "verification", "human"].includes(task.kind)) throw Error("Invalid task title/kind");
  for (const key of ["criteria", "dependencies", "capabilities", "checks"]) {
    if (!names(task[key])) throw Error(`Invalid task ${key}`);
  }
  if (!task.criteria.length || task.criteria.some((id) => !milestone.criteria.some((c) => c.id === id))) throw Error("Task references unknown criteria");
  if (task.kind !== "human" && task.criteria.some((id) => milestone.criteria.find((c) => c.id === id).kind === "human")) throw Error("Only human tasks may attest human criteria");
  if (task.kind !== "human" && !task.checks.length) throw Error("Automated tasks require independent checks");
  if (!Number.isInteger(task.priority)) throw Error("Task priority must be an integer");
  return task;
}
export function validateMilestone(milestone) {
  fields(milestone, ["id", "title", "scope", "allowedPaths", "criteria", "tasks", "finalChecks", "version"], "milestone");
  if (milestone.version !== undefined && milestone.version !== 2) throw Error("Unsupported milestone version");
  identifier(milestone.id);
  if (!text(milestone.title) || !text(milestone.scope) || !Array.isArray(milestone.allowedPaths) || !milestone.allowedPaths.length) throw Error("Milestone needs title, scope and allowedPaths");
  milestone.allowedPaths.forEach(relativePath);
  unique(milestone.criteria, "criteria");
  if (!milestone.criteria.length || !names(milestone.finalChecks) || !milestone.finalChecks.length) throw Error("Milestone requires criteria and finalChecks");
  for (const criterion of milestone.criteria) {
    fields(criterion, ["id", "description", "kind", "done", "evidence", "checks"], "criterion");
    if (!text(criterion.description) || !["automated", "human"].includes(criterion.kind) || typeof criterion.done !== "boolean" ||
        !Array.isArray(criterion.evidence) || criterion.evidence.some((e) => !text(e)) || !names(criterion.checks)) throw Error("Invalid acceptance criterion");
    if (criterion.kind === "automated" && !criterion.checks.length) throw Error("Automated criteria require checks");
  }
  unique(milestone.tasks, "task");
  milestone.tasks.forEach((task) => validateTask(task, milestone));
  validateGraph(milestone.tasks);
  return milestone;
}
export function validateGraph(tasks) {
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error("Task dependency cycle");
    if (visited.has(id)) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) throw Error(`Unknown task dependency: ${id}`);
    visiting.add(id);
    task.dependencies.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  tasks.forEach((task) => visit(task.id));
}
export function validateWorkPlan(plan) {
  fields(plan, ["version", "milestones"], "work plan");
  if (![1, 2].includes(plan.version)) throw Error("Unsupported work plan version");
  if (plan.milestones.some((m) => (m.version || 1) !== plan.version)) throw Error("Plan and milestone versions must match");
  unique(plan.milestones, "milestone");
  plan.milestones.forEach(validateMilestone);
  return plan;
}
export function approvalIdentity(milestone, config) {
  const criteria = milestone.criteria.map(({ done, evidence, ...criterion }) => criterion);
  return fingerprint({ milestone: { ...milestone, criteria, tasks: [] }, config });
}
export function selectReady(milestone, tasks, states, available) {
  return tasks.filter((task) => {
    if (states[task.id]?.status === "done" || states[task.id]?.status === "blocked") return false;
    if (task.criteria.every((id) => milestone.criteria.find((c) => c.id === id)?.done)) return false;
    if (task.kind === "human") return false;
    return task.dependencies.every((id) => states[id]?.status === "done" ||
      tasks.find((t) => t.id === id)?.criteria.every((c) => milestone.criteria.find((x) => x.id === c)?.done)) &&
      task.capabilities.every((id) => available.includes(id));
  }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
export function validateProposal(proposal, milestone, config, existing = []) {
  fields(proposal, ["tasks"], "task proposal");
  unique(proposal.tasks, "proposed task");
  if (!proposal.tasks.length || proposal.tasks.length > 10) throw Error("Propose 1–10 bounded tasks");
  for (const task of proposal.tasks) {
    validateTask(task, milestone);
    if ((task.operations || []).some((id) => !Object.hasOwn(config.operations || {}, id))) throw Error("Proposal requests an unapproved operation");
    if (existing.some((t) => t.id === task.id)) throw Error("Cannot replace an existing task");
    if (task.checks.some((id) => !Object.hasOwn(config.checks, id)) || task.capabilities.some((id) => !Object.hasOwn(config.capabilities, id))) throw Error("Proposal requests an unapproved capability/check");
  }
  validateGraph([...existing, ...proposal.tasks]);
  return proposal.tasks;
}
export function validateBindings(milestone, config) {
  if ((milestone.version || 1) !== (config.version || 1)) throw Error("Work configuration and milestone versions must match");
  if (milestone.tasks.some((t) => (t.operations || []).some((id) => !Object.hasOwn(config.operations || {}, id)))) throw Error("Task references an unconfigured operation");
  const checks = [...milestone.finalChecks, ...milestone.criteria.flatMap((c) => c.checks), ...milestone.tasks.flatMap((t) => t.checks)];
  if (checks.some((id) => !Object.hasOwn(config.checks, id))) throw Error("Milestone references an unconfigured check");
  if (milestone.tasks.flatMap((t) => t.capabilities).some((id) => !Object.hasOwn(config.capabilities, id))) throw Error("Milestone references an unconfigured capability");
}
export function taskChecks(task, milestone) {
  return [...new Set([...task.checks, ...(milestone.version === 2 && task.purpose === "prepare" ? [] :
    task.criteria.flatMap((id) => milestone.criteria.find((c) => c.id === id).checks))])];
}
export function taskCapabilities(task, milestone, config) {
  return [...new Set([...task.capabilities, ...taskChecks(task, milestone).flatMap((id) => config.checks[id]?.requires || []),
    ...(task.operations || []).flatMap((id) => [...(config.operations[id].requires || []), ...(config.checks[config.operations[id].verifier].requires || [])])])];
}
export function allowedChange(file, milestone, protectedPaths = []) {
  relativePath(file);
  if (file.split("/").some((part) => /^(?:\.git.*|\.qa.*|\.codex|\.agents|\.claude|\.cursor|AGENTS(?:\.override)?\.md|CLAUDE\.md|SKILL\.md)$/i.test(part))) return false;
  if (protectedPaths.some((p) => matches(file, p))) return false;
  return milestone.allowedPaths.some((pattern) => matches(file, pattern));
}
