import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { git } from "../lib/git.mjs";
import { fingerprint, selectReady, validateProposal, validateBindings } from "../lib/work-plan.mjs";
import { effectiveMilestone, startAttempt, failAttempt, handoff } from "../lib/work-state.mjs";
import { createRun, loadRun, saveRun, storePath, acquireLock, reconcileRun } from "./work-store.mjs";
import { workspaceSnapshot, headSnapshot, indexSnapshot, changedFiles, captureArtifacts, retainArtifacts, resourceIdentity } from "./work-evidence.mjs";
import { provisionInputs, assertInputs } from "./work-sandbox.mjs";
import { readMilestone, recordAcceptance } from "./work-source.mjs";
import { CodexExecutor } from "./work-codex.mjs";
import { loadConfig, resolveConfig } from "../lib/config.mjs";
import { diffContext } from "../lib/git.mjs";
import { checkPolicy } from "../lib/policy.mjs";

function standards() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills");
  return fs.readdirSync(root).sort().map((name) => fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8")).join("\n\n");
}
function pendingPlanning(state, milestone) {
  return milestone.criteria.filter((c) => !c.done && c.kind === "automated" &&
    !state.tasks.some((t) => t.criteria.includes(c.id) && state.states[t.id]?.status !== "done"));
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
  const criteria = pendingPlanning(state, milestone);
  if (!criteria.length || (state.planFailures || 0) >= 3) return false;
  try {
    const proposal = await executor.plan({ ...milestone, criteria }, state.tasks, state.states);
    const tasks = validateProposal(proposal, milestone, state.config, state.tasks);
    if (tasks.some((t) => t.criteria.some((id) => !criteria.some((c) => c.id === id)))) throw Error("Proposal retries blocked or unrelated criteria");
    const review = await executor.reviewPlan(milestone, tasks);
    if (review.scope !== "within-request" || review.report.status !== "passed") throw Error("Derived plan did not pass independent scope review");
    state.tasks.push(...tasks);
    return true;
  } catch (e) {
    state.planFailures = (state.planFailures || 0) + 1;
    state.planningReason = e.message;
    return false;
  }
}
function finishPending(state) {
  const operation = state.pending;
  if (!operation) return;
  if (operation.changed.length && !operation.commit) throw Error("Checkpoint commit has not been reconciled");
  recordAcceptance(state.root, state.config, state, operation);
  state.receipts[operation.taskId] = operation.receipt;
  state.states[operation.taskId].status = "done";
  for (const id of operation.receipt.review.resolvedSources) {
    const criterion = state.milestone.criteria.find((c) => c.id === id);
    if (criterion?.kind !== "automated") throw Error("Automatic human acceptance refused");
    state.accepted[id] = { evidence: operation.receipt.id, sourceHead: state.head, kind: "verified" };
    state.revalidation = (state.revalidation || []).filter((criterionId) => criterionId !== id);
  }
  if (!state.checkpoints.some((c) => c.id === operation.id)) state.checkpoints.push({ id: operation.id, task: operation.taskId, commit: state.head });
  state.pending = null;
}
async function performTask(executor, context, state, directory, task, inputIdentity) {
  const releases = [];
  try {
    for (const capability of [...task.capabilities].sort()) {
      releases.push(acquireLock(path.join(os.tmpdir(), `qa-capabilities-${process.getuid()}`, capability + ".lock"), { recover: true }));
    }
    startAttempt(state, task);
    const previousOutput = path.join(state.worktree, ".qa-output");
    if (fs.existsSync(previousOutput)) {
      const archive = path.join(directory, "attempt-outputs", `${task.id}-${state.states[task.id].attempts}-${crypto.randomUUID()}`);
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      fs.cpSync(previousOutput, archive, { recursive: true, dereference: false });
    }
    saveRun(directory, state, { type: "attempt", task: task.id, attempt: state.states[task.id].attempts });
    const before = workspaceSnapshot(state.worktree);
    assertActive(context);
    const result = await executor.execute(effectiveMilestone(state, { milestone: state.milestone }), task, state.states[task.id].feedback || null);
    const candidate = workspaceSnapshot(state.worktree);
    assertInputs(context);
    changedFiles(before, candidate, state.milestone);
    const ids = [...task.checks, ...task.criteria.flatMap((id) => state.milestone.criteria.find((c) => c.id === id).checks)];
    const checks = await checkSet(executor, state.config, ids, context);
    if (checks.some((c) => c.status !== "passed")) throw Object.assign(Error("Observed validation failed"), { feedback: checks });
    if (fingerprint(workspaceSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Checks changed source; configure fresh ignored output paths");
    if (resourceIdentity(context.resources) !== inputIdentity) throw Error("Declared input resources changed during the task");
    assertInputs(context);
    const artifacts = captureArtifacts(state.worktree, [...(result.evidencePaths || []),
      ...ids.flatMap((id) => state.config.checks[id].outputs || [])]);
    const evidence = { id: crypto.randomUUID(), task: task.id, source: fingerprint(candidate), inputIdentity,
      summary: result.summary, checks, artifacts, kind: "observed", baseHead: state.head,
      changedPaths: changedFiles(headSnapshot(state.worktree), candidate, state.milestone) };
    evidence.artifacts = retainArtifacts(state.worktree, directory, evidence.id, artifacts);
    if (evidence.changedPaths.length) git(state.worktree, ["-c", "core.hooksPath=/dev/null", "add", "--", ...evidence.changedPaths]);
    const diff = diffContext(state.worktree, { staged: true });
    evidence.patch = diff.patch; evidence.coverage = diff.coverage;
    evidence.policy = checkPolicy(diff, context.policy).report;
    if (evidence.policy.status !== "passed") throw Error("Local QA policy did not pass");
    assertActive(context);
    const review = await executor.review(state.milestone, task, evidence);
    if (review.scope !== "within-request" || review.report.status !== "passed") throw Object.assign(Error("Independent review did not pass"), { feedback: review, terminal: review.scope !== "within-request" || ["unavailable", "skipped"].includes(review.report.status) });
    if (review.resolvedSources.some((id) => !task.criteria.includes(id) || state.milestone.criteria.find((c) => c.id === id)?.kind !== "automated")) throw Error("Reviewer claimed unrequested or human acceptance");
    if (fingerprint(workspaceSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Read-only review changed source");
    const changed = changedFiles(headSnapshot(state.worktree), candidate, state.milestone);
    assertActive(context);
    evidence.review = review;
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
    finishPending(state);
    saveRun(directory, state, { type: "done", task: task.id });
    return true;
  } catch (e) {
    if (state.pending) throw e; // Resume must reconcile a possibly published local commit first.
    if (!state.states[task.id] || state.states[task.id].status !== "running") {
      state.states[task.id] = { ...(state.states[task.id] || {}), status: "blocked", reason: e.message };
    } else {
      state.states[task.id].feedback = e.feedback || e.message;
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
export async function runMilestone(root, config, id, { approve = false, resume = false,
  executorFactory = (context, options) => new CodexExecutor(context, options), now = Date.now,
  signal, onProgress = () => {} } = {}) {
  if (!approve && !resume) throw Error("Use --approve after reviewing the milestone plan");
  const deadline = now() + config.minutes * 60000;
  const release = acquireLock(storePath(root, id) + ".lock", { recover: resume });
  let state, directory;
  try {
    const snapshot = readMilestone(root, config, id);
    validateBindings(snapshot.milestone, config);
    if (resume) ({ state, directory } = loadRun(root, id));
    else {
      if (!approve) throw Error("Use --approve after reviewing the milestone plan");
      ({ state, directory } = createRun(root, snapshot, config));
    }
    reconcileRun(state, snapshot, config);
    if (state.pending) {
      if (state.pending.changed.length && !state.pending.commit) {
        state.states[state.pending.taskId].status = "ready";
        state.pending = null;
        saveRun(directory, state, { type: "uncommitted-candidate-retained-for-revalidation" });
      } else { finishPending(state); saveRun(directory, state, { type: "recovered-checkpoint" }); }
    }
    const context = { workspace: state.worktree, directory, common: path.dirname(path.dirname(directory)),
      resources: config.resources, codex: config.codex, model: config.model, checks: config.checks,
      capabilities: config.capabilities, standards: standards(), deadline, now, signal };
    context.policy = fs.existsSync(path.join(root, ".qa.json")) ? loadConfig(path.join(root, ".qa.json")) : resolveConfig();
    for (const file of git(state.worktree, ["ls-files", "-z", "--", "*AGENTS.md", "*CLAUDE.md"]).split("\0").filter(Boolean)) {
      context.standards += `\nRepository instructions at ${file} (apply to that subtree):\n${fs.readFileSync(path.join(state.worktree, file), "utf8")}\n`;
    }
    provisionInputs(context);
    const inputIdentity = resourceIdentity(config.resources);
    if (state.inputIdentity && state.inputIdentity !== inputIdentity) throw Error("Declared input identities changed; previous receipts cannot be silently reused");
    state.inputIdentity = inputIdentity;
    const processOptions = () => ({ timeoutMs: Math.min(1800000, Math.max(1, deadline - now())), signal,
      onStart: (pid) => { state.processes = [{ pid }]; saveRun(directory, state); },
      onEnd: () => { state.processes = []; saveRun(directory, state); } });
    const executor = executorFactory(context, processOptions);
    await executor.doctor();
    const available = [];
    for (const [name, command] of Object.entries(config.capabilities)) {
      if ((await executor.check(command)).status === "passed") available.push(name);
    }
    state.available = available;
    let completed = 0;
    state.status = "running";
    while (now() < deadline && completed < config.tasks && !signal?.aborted) {
      const current = readMilestone(root, config, id);
      reconcileRun(state, current, config);
      state.milestone = current.milestone;
      const milestone = effectiveMilestone(state, current);
      if (milestone.criteria.every((c) => c.done)) {
        const before = fingerprint(workspaceSnapshot(state.worktree));
        const finalChecks = await checkSet(executor, config, milestone.finalChecks, context);
        state.finalChecks = { head: state.head, results: finalChecks };
        if (finalChecks.every((r) => r.status === "passed") && fingerprint(workspaceSnapshot(state.worktree)) === before) { state.status = "completed"; break; }
        state.revalidation = milestone.criteria.filter((c) => c.kind === "automated").map((c) => c.id);
        state.finalFailure = finalChecks;
        saveRun(directory, state, { type: "final-revalidation-needed" });
        continue;
      }
      const ready = selectReady(milestone, state.tasks, state.states, available);
      if (!ready.length) {
        if (await deriveTasks(executor, state, milestone)) { saveRun(directory, state, { type: "planned" }); continue; }
        state.status = milestone.criteria.filter((c) => !c.done).every((c) => c.kind === "human") ? "awaiting-human" : "blocked";
        break;
      }
      const task = ready[0]; onProgress({ task: task.id, phase: "execute" });
      if (await performTask(executor, context, state, directory, task, inputIdentity)) completed++;
      else if (state.states[task.id]?.status === "blocked" && git(state.worktree, ["status", "--porcelain"]).trim()) {
        quarantine(context, state);
        saveRun(directory, state, { type: "quarantined", task: task.id });
      }
    }
    if (state.status === "running") state.status = signal?.aborted ? "interrupted" : "budget-paused";
    saveRun(directory, state, { type: "handoff", status: state.status });
    return handoff(state, effectiveMilestone(state, { milestone: state.milestone }), available);
  } catch (e) {
    if (state) { state.status = "unavailable"; state.reason = e.message; saveRun(directory, state, { type: "unavailable", reason: e.message }); }
    throw e;
  } finally { release(); }
}
