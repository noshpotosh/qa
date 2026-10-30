import { beginInvocation, endInvocation } from './work-lifecycle.mjs';
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { git } from "../lib/git.mjs";
import { fingerprint, selectReady, validateProposal, validateBindings, taskChecks, taskCapabilities } from "../lib/work-plan.mjs";
import { effectiveMilestone, startAttempt, failAttempt, handoff, preparePlanningContext } from "../lib/work-state.mjs";
import { createRun, loadRun, saveRun, storePath, acquireLock, reconcileRun } from "./work-store.mjs";
import { workspaceSnapshot, headSnapshot, indexSnapshot, changedFiles, captureArtifacts, retainArtifacts, resourceIdentity } from "./work-evidence.mjs";
import { provisionInputs, assertInputs } from "./work-sandbox.mjs";
import { readMilestone, recordAcceptance, authorityPaths } from "./work-source.mjs";
import { CodexExecutor } from "./work-codex.mjs";
import { loadConfig, resolveConfig } from "../lib/config.mjs";
import { diffContext } from "../lib/git.mjs";
import { checkPolicy } from "../lib/policy.mjs";
import { checkpointAdapterOutputs } from "./work-checkpoint.mjs";
import { finishAttestation } from "./work-operator.mjs";
import { refreshCapabilities } from "./work-probes.mjs";
import { runOperations } from "./work-operations.mjs";

function standards() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills");
  return fs.readdirSync(root).sort().map((name) => fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8")).join("\n\n");
}
function pendingPlanning(state, milestone) {
  return milestone.criteria.filter((c) => !c.done && c.kind === "automated" &&
    (!state.focus?.length || state.focus.includes(c.id)) &&
    !state.tasks.some((t) => t.criteria.includes(c.id) && (!state.focus?.length || t.criteria.every((id) => state.focus.includes(id))) && state.states[t.id]?.status !== "done" &&
      (milestone.version !== 2 || taskCapabilities(t, milestone, state.config).every((id) => state.available.includes(id)))));
}
function assertActive(context) {
  if (context.signal?.aborted) throw Error("Run interrupted; partial workspace retained");
  if (context.now() >= context.deadline) throw Error("Invocation budget expired; partial workspace retained");
}
async function checkSet(executor, config, ids, context) {
  const results = [];
  for (const id of [...new Set(ids)]) {
    assertActive(context);
    if (!config.checks[id]) throw Error(`Unknown approved check: ${id}`);
    const result = await executor.check(config.checks[id]);
    results.push({ id, command: config.checks[id].argv, ...result });
  }
  return results;
}
async function deriveTasks(executor, state, milestone) {
  const criteria = pendingPlanning(state, milestone).filter((c) => milestone.version === 2 || c.checks.every((id) =>
    (state.config.checks[id]?.requires || []).every((capability) => (state.available || []).includes(capability))));
  if (!criteria.length) return false;
  preparePlanningContext(state, criteria);
  if ((state.planFailures || 0) >= 3) return false;
  try {
    const proposal = await executor.plan({ ...milestone, criteria }, state.tasks, { states: state.states, finalFailure: state.finalFailure, source: state.sourceContext });
    const tasks = validateProposal(proposal, milestone, state.config, state.tasks);
    if (tasks.some((t) => t.criteria.some((id) => !criteria.some((c) => c.id === id)))) throw Error("Proposal retries blocked or unrelated criteria");
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
function finishPending(state, directory) {
  const operation = state.pending;
  if (!operation) return;
  if (operation.changed.length && !operation.commit) throw Error("Checkpoint commit has not been reconciled");
  state.codeHead = operation.commit || state.codeHead || state.baseline;
  const files = recordAcceptance(state.root, state.config, state, operation);
  checkpointAdapterOutputs(state, directory, operation, files);
  if (state.receipts[operation.taskId]?.id !== operation.receipt.id) state.generation = (state.generation || 0) + 1;
  const seen = new Set(Object.values(state.receipts).flatMap((receipt) => receipt.progressArtifacts ?? receipt.artifacts ?? []).map((a) => `${a.path}:${a.sha256}`));
  const newEvidence = (operation.receipt.progressArtifacts || []).some((a) => !seen.has(`${a.path}:${a.sha256}`));
  state.receipts[operation.taskId] = operation.receipt;
  state.states[operation.taskId].status = "done";
  for (const id of operation.receipt.review.resolvedSources) {
    const criterion = state.milestone.criteria.find((c) => c.id === id);
    if (criterion?.kind !== "automated") throw Error("Automatic human acceptance refused");
    state.accepted[id] = { evidence: operation.receipt.id, sourceHead: state.head, kind: "verified" };
    state.revalidation = (state.revalidation || []).filter((criterionId) => criterionId !== id);
  }
  if (!state.checkpoints.some((c) => c.id === operation.id)) state.checkpoints.push({ id: operation.id, task: operation.taskId, commit: state.head });
  const progressed = state.milestone.version === 2 ? operation.receipt.review.progress?.advanced || operation.receipt.review.resolvedSources.length
    : operation.changed.length || newEvidence || operation.receipt.review.resolvedSources.length;
  state.noProgress = progressed ? 0 : (state.noProgress || 0) + 1;
  state.pending = null;
  state.validationCandidate = null;
}
async function validateFinal(executor, context, state, directory, milestone, inputIdentity) {
  const releases = [];
  try {
  for (const capability of [...new Set(milestone.finalChecks.flatMap((id) => state.config.checks[id].requires || []))].sort()) {
    releases.push(acquireLock(path.join(os.tmpdir(), `qa-capabilities-${process.getuid()}`, capability + ".lock"), { recover: true }));
  }
  const before = fingerprint(workspaceSnapshot(state.worktree));
  const results = await checkSet(executor, state.config, milestone.finalChecks, context);
  assertInputs(context);
  if (resourceIdentity(context.resources) !== inputIdentity || fingerprint(workspaceSnapshot(state.worktree)) !== before) throw Error("Final validation changed source or declared inputs");
  const artifacts = results.every((result) => result.status === "passed")
    ? captureArtifacts(state.worktree, milestone.finalChecks.flatMap((id) => state.config.checks[id].outputs || [])) : [];
  state.finalChecks = { head: state.head, codeHead: state.codeHead, generation: state.generation || 0, results,
    artifacts: retainArtifacts(state.worktree, directory, crypto.randomUUID(), artifacts) };
  if (results.some((r) => r.status === "unavailable")) { state.status = "unavailable"; state.reason = "Final validation unavailable"; return false; }
  if (results.every((r) => r.status === "passed")) return true;
  state.revalidation = milestone.criteria.filter((c) => c.kind === "automated").map((c) => c.id);
  state.finalFailure = results;
  saveRun(directory, state, { type: "final-revalidation-needed" });
  return false;
  } finally { releases.reverse().forEach((release) => release()); }
}
async function inspectCandidate(executor, context, state, directory, task, inputIdentity, before, result) {
  const candidate = workspaceSnapshot(state.worktree);
  assertInputs(context);
  changedFiles(before, candidate, state.milestone, context.protectedPaths);
  const ids = taskChecks(task, state.milestone);
  const checks = await checkSet(executor, state.config, ids, context);
  if (checks.some((c) => c.status !== "passed")) throw Object.assign(Error("Observed validation failed"), { feedback: checks, terminal: checks.some((c) => c.status === "unavailable"), unavailable: checks.some((c) => c.status === "unavailable") });
  if (fingerprint(workspaceSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Checks changed source; configure fresh ignored output paths");
  if (resourceIdentity(context.resources) !== inputIdentity) throw Error("Declared input resources changed during the task");
  assertInputs(context);
  const artifacts = captureArtifacts(state.worktree, [...(result.evidencePaths || []), ...(result.operations || []).flatMap((o) => o.artifacts.map((a) => a.path)),
    ...ids.flatMap((id) => state.config.checks[id].outputs || [])]);
  const evidence = { id: crypto.randomUUID(), task: task.id, source: fingerprint(candidate), inputIdentity,
    summary: result.summary, checks, operations: result.operations || [], artifacts, kind: "observed", baseHead: state.head,
    ...(state.milestone.version === 2 ? { previousProgress: Object.values(state.receipts).map((r) => r.review.progress).filter(Boolean) } : {}),
    changedPaths: changedFiles(headSnapshot(state.worktree), candidate, state.milestone, context.protectedPaths) };
  evidence.artifacts = retainArtifacts(state.worktree, directory, evidence.id, artifacts);
  const outputs = new Set(ids.flatMap((id) => state.config.checks[id].outputs || []));
  evidence.progressArtifacts = artifacts.filter((a) => (result.evidencePaths || []).includes(a.path) && !outputs.has(a.path));
  if (evidence.changedPaths.length) git(state.worktree, ["-c", "core.hooksPath=/dev/null", "add", "--", ...evidence.changedPaths]);
  const diff = diffContext(state.worktree, { staged: true });
  evidence.patch = diff.patch; evidence.coverage = diff.coverage;
  evidence.policy = checkPolicy(diff, context.policy).report;
  if (evidence.policy.status !== "passed") throw Error("Local QA policy did not pass");
  assertActive(context);
  const review = await executor.review(state.milestone, task, evidence);
  if (review.scope !== "within-request" || review.report.status !== "passed") throw Object.assign(Error("Independent review did not pass"), { feedback: review, terminal: review.scope !== "within-request" || ["unavailable", "skipped"].includes(review.report.status) });
  if (review.resolvedSources.some((id) => !task.criteria.includes(id) || state.milestone.criteria.find((c) => c.id === id)?.kind !== "automated")) throw Error("Reviewer claimed unrequested or human acceptance");
  if (state.milestone.version === 2) {
    if (task.purpose === "prepare" && review.resolvedSources.length) throw Error("Preparation cannot grant criterion acceptance");
    const p = review.progress;
    if (!p || typeof p.advanced !== "boolean" || typeof p.answer !== "string" || !Array.isArray(p.evidencePaths) ||
        p.evidencePaths.some((name) => !artifacts.some((a) => a.path === name)) ||
        (p.advanced && (!p.answer.trim() || !p.evidencePaths.length))) throw Error("Progress requires an independently reviewed answer and observed artifacts");
  }
  if (fingerprint(workspaceSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Read-only review changed source");
  const changed = changedFiles(headSnapshot(state.worktree), candidate, state.milestone, context.protectedPaths);
  assertActive(context);
  evidence.review = review;
  return { evidence, candidate, changed };
}
function commitCandidate(state, directory, task, evidence, candidate, changed) {
  reconcileRun(state, { milestone: state.milestone }, state.config);
  state.pending = { id: crypto.randomUUID(), taskId: task.id, receipt: evidence, changed, tree: null };
  if (changed.length) {
    git(state.worktree, ["-c", "core.hooksPath=/dev/null", "add", "--", ...changed]);
    if (fingerprint(indexSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Staged tree differs from the validated candidate");
    state.pending.tree = git(state.worktree, ["write-tree"]).trim();
    saveRun(directory, state, { type: "checkpoint-prepared", task: task.id });
    git(state.worktree, ["-c", "core.hooksPath=/dev/null", "commit", "-m", `${task.title}\n\nQA-Operation: ${state.pending.id}`]);
    state.head = git(state.worktree, ["rev-parse", "HEAD"]).trim();
    state.pending.commit = state.head;
  }
  saveRun(directory, state, { type: "checkpoint", task: task.id });
  finishPending(state, directory);
  saveRun(directory, state, { type: "done", task: task.id });
}
async function performTask(executor, context, state, directory, task, inputIdentity) {
  const releases = [];
  try {
    for (const capability of [...task.capabilities].sort()) {
      releases.push(acquireLock(path.join(os.tmpdir(), `qa-capabilities-${process.getuid()}`, capability + ".lock"), { recover: true }));
    }
    const replay = state.validationCandidate?.taskId === task.id ? state.validationCandidate : null;
    if (replay) {
      if (replay.attempt !== state.states[task.id].attempts || replay.head !== state.head || replay.snapshot !== fingerprint(workspaceSnapshot(state.worktree))) throw Error("Retained validation candidate changed");
      state.states[task.id].status = "running";
    } else {
      startAttempt(state, task);
      if (state.invocation) state.invocation.attemptsStarted++;
    }
    const previousOutput = path.join(state.worktree, ".qa-output");
    if (fs.existsSync(previousOutput)) {
      const archive = path.join(directory, "attempt-outputs", `${task.id}-${state.states[task.id].attempts}-${crypto.randomUUID()}`);
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      fs.cpSync(previousOutput, archive, { recursive: true, dereference: false });
    }
    if (state.invocation) state.invocation.phase = `${replay ? "validation" : "execute"}:${task.id}`;
    saveRun(directory, state, { type: replay ? "validation-continuation" : "attempt", task: task.id, attempt: state.states[task.id].attempts });
    const before = workspaceSnapshot(state.worktree);
    assertActive(context);
    const result = replay ? replay.result : await executor.execute(effectiveMilestone(state, { milestone: state.milestone }), task, { previous: state.states[task.id].feedback || null, source: state.sourceContext });
    state.validationCandidate = { taskId: task.id, attempt: state.states[task.id].attempts, head: state.head, result, snapshot: fingerprint(workspaceSnapshot(state.worktree)) };
    saveRun(directory, state, { type: replay ? "validation-resumed" : "editor-result-retained", task: task.id, attempt: state.states[task.id].attempts });
    if (state.milestone.version === 2) {
      changedFiles(before, workspaceSnapshot(state.worktree), state.milestone, context.protectedPaths);
      result.operations = await runOperations(executor, context, state, directory, task);
    }
    saveRun(directory, state);
    const { evidence, candidate, changed } = await inspectCandidate(executor, context, state, directory, task, inputIdentity, before, result);
    commitCandidate(state, directory, task, evidence, candidate, changed);
    state.validationCandidate = null;
    saveRun(directory, state);
    return true;
  } catch (e) {
    if (state.pending) throw e; // Resume must reconcile a possibly published local commit first.
    if (e.operationUncertain && state.validationCandidate) {
      state.states[task.id].status = "blocked";
      state.states[task.id].reason = e.message;
      saveRun(directory, state, { type: "operation-uncertain", task: task.id, reason: e.message });
      throw e;
    }
    if (e.code === "ENOBUFS" && state.validationCandidate) {
      state.states[task.id].status = "ready";
      saveRun(directory, state, { type: "controller-validation-unavailable", task: task.id, reason: e.message });
      throw e;
    }
    state.validationCandidate = null;
    if (!state.states[task.id] || state.states[task.id].status !== "running") {
      state.states[task.id] = { ...(state.states[task.id] || {}), status: "blocked", reason: e.message };
    } else {
      state.states[task.id].feedback = e.feedback || e.message;
      state.states[task.id].unavailable = !!e.unavailable;
      failAttempt(state, task, e.message, { terminal: !!e.terminal });
    }
    saveRun(directory, state, { type: "attempt-failed", task: task.id, reason: e.message });
    return false;
  } finally { releases.reverse().forEach((release) => release()); }
}
function quarantine(context, state) {
  const previous = state.worktree;
  git(previous, ["switch", "--detach"]);
  const next = path.join(state.root, ".qa-worktrees", `${state.id}-${crypto.randomBytes(4).toString("hex")}`);
  git(state.root, ["worktree", "add", next, state.branch]);
  state.quarantined = [...(state.quarantined || []), previous];
  state.worktree = next; context.workspace = next;
  provisionInputs(context);
}
async function executeLoop(executor, context, state, directory, inputIdentity, onProgress) {
  const { now, deadline, signal } = context, config = state.config, root = state.root, id = state.id;
  let completed = 0;
  while (now() < deadline && completed < config.tasks && !signal?.aborted) {
    const current = readMilestone(root, config, id);
    reconcileRun(state, current, config);
    state.milestone = current.milestone;
    state.sourceContext = current.context || null;
    const milestone = effectiveMilestone(state, current);
    if (state.focus?.length && milestone.criteria.filter((c) => state.focus.includes(c.id)).every((c) => c.done)) {
      if (await validateFinal(executor, context, state, directory, milestone, inputIdentity)) { state.status = "focus-completed"; break; }
      if (state.status === "unavailable") break;
      continue;
    }
    if (milestone.criteria.filter((c) => c.kind === "automated").every((c) => c.done)) {
      if (await validateFinal(executor, context, state, directory, milestone, inputIdentity)) {
        state.status = milestone.criteria.every((c) => c.done) ? "completed" : "awaiting-human"; break;
      }
      if (state.status === "unavailable") break;
      continue;
    }
    const tasks = state.tasks.filter((task) => !state.focus?.length || task.criteria.every((id) => state.focus.includes(id)))
      .map((task) => ({ ...task, capabilities: taskCapabilities(task, milestone, config) }));
    let ready = selectReady(milestone, tasks, state.states, context.available);
    if (!ready.length) {
      if (milestone.version === 2 && state.lastBlockedProbeHead !== state.head) {
        await refreshCapabilities(executor, context, state, directory);
        state.lastBlockedProbeHead = state.head;
        ready = selectReady(milestone, tasks, state.states, context.available);
        if (ready.length) continue;
      }
      if (await deriveTasks(executor, state, milestone)) { saveRun(directory, state, { type: "planned" }); continue; }
      state.status = milestone.criteria.filter((c) => !c.done && (!state.focus?.length || state.focus.includes(c.id))).every((c) => c.kind === "human") ? "awaiting-human" : "blocked";
      break;
    }
    const task = ready[0]; onProgress({ task: task.id, phase: "execute" });
    if (await performTask(executor, context, state, directory, task, inputIdentity)) {
      completed++;
      if (milestone.version === 2) await refreshCapabilities(executor, context, state, directory);
      if (state.noProgress >= 3) { state.status = "blocked"; state.reason = milestone.version === 2 ? "Three tasks produced no independently reviewed advancement" : "Three tasks produced no source, artifact or acceptance progress"; break; }
    }
    else if (state.states[task.id]?.status === "blocked" && git(state.worktree, ["status", "--porcelain"]).trim()) {
      quarantine(context, state);
      saveRun(directory, state, { type: "quarantined", task: task.id });
    }
  }
}
export async function runMilestone(root, config, id, { approve = false, resume = false, retryUnavailable = false, focus,
  executorFactory = (context, options) => new CodexExecutor(context, options), now = Date.now,
  signal, onProgress = () => {} } = {}) {
  if (!approve && !resume) throw Error("Use --approve after reviewing the milestone plan");
  const deadline = now() + config.minutes * 60000;
  const invocationStart = now();
  const resources = config.resources.map((resource) => ({ ...resource, source: path.resolve(root, resource.source) }));
  const release = acquireLock(storePath(root, id) + ".lock", { recover: resume });
  let state, directory, invocationId;
  try {
    const snapshot = readMilestone(root, config, id);
    validateBindings(snapshot.milestone, config);
    if (focus !== undefined && (config.version !== 2 || !Array.isArray(focus) || new Set(focus).size !== focus.length || focus.some((id) => !snapshot.milestone.criteria.some((c) => c.id === id)))) throw Error("Focus requires unique existing v2 criterion IDs");
    if (resume) ({ state, directory } = loadRun(root, id));
    else {
      if (!approve) throw Error("Use --approve after reviewing the milestone plan");
      ({ state, directory } = createRun(root, snapshot, config));
    }
    reconcileRun(state, snapshot, config);
    if (config.version === 2) {
      beginInvocation(state, invocationStart, deadline); state.status = "running"; invocationId = state.invocation.id;
      saveRun(directory, state, { type: 'invocation-began', invocation: invocationId });
    }
    if (focus !== undefined) {
      if (state.validationCandidate && !state.tasks.find((t) => t.id === state.validationCandidate.taskId)?.criteria.every((id) => focus.includes(id)) && focus.length) throw Error("Finish the retained candidate before changing focus");
      state.focus = focus;
      saveRun(directory, state, { type: "focus-selected", criteria: focus });
    }
    if (state.inputIdentity && resourceIdentity(resources) !== state.inputIdentity) throw Error("Declared input identities changed; pending acceptance was not replayed");
    if (state.operatorPending) finishAttestation(root, config, state, directory);
    if (state.pending) {
      if (state.pending.changed.length && !state.pending.commit) {
        state.states[state.pending.taskId].status = "ready";
        state.pending = null;
        saveRun(directory, state, { type: "uncommitted-candidate-retained-for-revalidation" });
      } else { finishPending(state, directory); saveRun(directory, state, { type: "recovered-checkpoint" }); }
    }
    const context = { workspace: state.worktree, sourceRoot: state.root, baseline: state.baseline, directory, common: path.dirname(path.dirname(directory)),
      resources, codex: config.codex, model: config.model, checks: config.checks,
      capabilities: config.capabilities, standards: standards(), deadline, now, signal,
      operations: config.operations || {},
      readRoots: config.readRoots.map((p) => path.resolve(root, p)), protectedPaths: authorityPaths(root, config) };
    context.policy = fs.existsSync(path.join(root, ".qa.json")) ? loadConfig(path.join(root, ".qa.json")) : resolveConfig();
    const instructions = git(state.worktree, ["ls-files", "-z", "--", "*AGENTS.md", "*AGENTS.override.md", "*CLAUDE.md"]).split("\0").filter(Boolean);
    for (const file of instructions.filter((file) => !file.endsWith("AGENTS.md") || !instructions.includes(file.replace(/AGENTS\.md$/, "AGENTS.override.md")))) {
      context.standards += `\nRepository instructions at ${file} (apply to that subtree):\n${fs.readFileSync(path.join(state.worktree, file), "utf8")}\n`;
    }
    provisionInputs(context);
    const inputIdentity = resourceIdentity(resources);
    if (state.inputIdentity && state.inputIdentity !== inputIdentity) throw Error("Declared input identities changed; previous receipts cannot be silently reused");
    state.inputIdentity = inputIdentity;
    const processOptions = (phase) => ({ timeoutMs: Math.min(1800000, Math.max(1, deadline - now())), signal,
      onStart: (pid) => { if (state.invocation && phase) state.invocation.phase = phase; state.processes = [{ pid }]; saveRun(directory, state, { type: 'process-started', pid, invocation: invocationId, phase: state.invocation?.phase }); },
      onEnd: (result) => { state.processes = []; const { output, ...exit } = result || {}; saveRun(directory, state, { type: 'process-ended', invocation: invocationId, phase: state.invocation?.phase, ...exit }); } });
    const executor = executorFactory(context, processOptions);
    await executor.doctor();
    if (resume && retryUnavailable) {
      for (const [task, attempt] of Object.entries(state.states)) {
        const unavailable = attempt.unavailable || /^Codex (execute|review) unavailable:/.test(attempt.reason || "") ||
          (Array.isArray(attempt.feedback) && attempt.feedback.some((check) => check.status === "unavailable"));
        if (attempt.status === "blocked" && unavailable && attempt.attempts < config.attempts && (state.failureKeys[attempt.key] || 0) < config.attempts) {
          attempt.status = "ready";
          saveRun(directory, state, { type: "unavailable-retry-requested", task, attempts: attempt.attempts });
        }
      }
    }
    const available = config.version === 2 ? await refreshCapabilities(executor, context, state, directory) : [];
    if (config.version !== 2) for (const [name, command] of Object.entries(config.capabilities)) {
      if ((await executor.check(command)).status === "passed") available.push(name);
    }
    state.available = available;
    context.available = available;
    if (config.requiredCapabilities.some((name) => !available.includes(name))) throw Error(`Required capabilities unavailable: ${config.requiredCapabilities.filter((name) => !available.includes(name)).join(", ")}`);
    if (state.noProgress >= 3) { state.status = "blocked"; state.reason = "No-progress budget exhausted; existing evidence and attempts preserved"; if (invocationId) endInvocation(state, now()); return handoff(state, effectiveMilestone(state, snapshot), available); }
    state.status = "running";
    state.reason = null;
    await executeLoop(executor, context, state, directory, inputIdentity, onProgress);
    if (state.status === "running") {
      state.status = signal?.aborted ? "interrupted" : "budget-paused";
      state.reason = signal?.aborted ? 'User interruption' : now() >= deadline ? 'Invocation time budget exhausted' : 'Invocation task budget exhausted';
    }
    if (invocationId) endInvocation(state, now());
    saveRun(directory, state, { type: "handoff", status: state.status });
    if (config.version !== 2) state.elapsedMs = (state.elapsedMs || 0) + Math.max(0, now() - invocationStart);
    if (config.version === 2) saveRun(directory, state, { type: resume ? "invocation-resumed" : "invocation-started", status: state.status });
    return handoff(state, effectiveMilestone(state, { milestone: state.milestone }), context.available);
  } catch (e) {
    if (state) { state.status = signal?.aborted ? "interrupted" : now() >= deadline ? "budget-paused" : "unavailable"; state.reason = e.message; saveRun(directory, state, { type: "unavailable", reason: e.message }); }
    throw e;
  } finally {
    try {
      if (invocationId && state.invocation?.id === invocationId) {
        endInvocation(state, now());
        saveRun(directory, state, { type: 'invocation-ended', invocation: invocationId, status: state.status });
      }
    } finally { release(); }
  }
}
