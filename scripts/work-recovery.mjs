import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/git.mjs";
import { fingerprint } from "../lib/work-plan.mjs";
import { safePath } from "../lib/install.mjs";
import { loadRun, storePath, acquireLock, reconcileRun, saveRun } from "./work-store.mjs";
import { readMilestone, authorityPaths } from "./work-source.mjs";
import { headSnapshot, workspaceSnapshot, changedFiles } from "./work-evidence.mjs";

// Migrate a retained pre-checkpoint editor result from the initial runner.
// This completes validation of that same attempt; it never invokes an editor.
export function recoverValidation(root, config, id, taskId) {
  const release = acquireLock(storePath(root, id) + ".lock", { recover: true });
  try {
    const { state, directory } = loadRun(root, id);
    reconcileRun(state, readMilestone(root, config, id), config);
    const attempt = state.states[taskId];
    if (state.pending || state.validationCandidate || attempt?.status !== "blocked" || attempt.reason !== "spawnSync git ENOBUFS") throw Error("Only a retained controller-buffer failure is recoverable");
    const start = state.events.findLast((event) => event.type === "attempt" && event.task === taskId && event.attempt === attempt.attempts);
    const end = state.events.findLast((event) => event.type === "attempt-failed" && event.task === taskId);
    if (!start || !end) throw Error("Missing original attempt interval");
    const results = fs.readdirSync(directory).filter((name) => /^execute-[\da-f-]+\.json$/.test(name)).filter((name) => {
      const time = fs.statSync(safePath(directory, name)).mtimeMs;
      return time >= Date.parse(start.at) && time <= Date.parse(end.at);
    });
    if (results.length !== 1) throw Error("Original editor result is ambiguous; no attempt was reset");
    const result = JSON.parse(fs.readFileSync(safePath(directory, results[0]), "utf8"));
    if (typeof result.summary !== "string" || !Array.isArray(result.evidencePaths) || result.evidencePaths.some((p) => typeof p !== "string")) throw Error("Invalid original editor result");
    const retained = state.quarantined?.at(-1);
    if (!retained || !fs.realpathSync(retained).startsWith(path.join(fs.realpathSync(root), ".qa-worktrees") + path.sep) || git(retained, ["rev-parse", "HEAD"]).trim() !== state.head) throw Error("Retained candidate identity changed");
    if (git(state.worktree, ["status", "--porcelain"]).trim()) throw Error("Current owned workspace has changes; preserved without overwrite");
    const candidate = workspaceSnapshot(retained);
    const changed = changedFiles(headSnapshot(retained), candidate, state.milestone, authorityPaths(root, config));
    for (const name of changed) {
      const source = safePath(retained, name), target = safePath(state.worktree, name);
      if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); fs.chmodSync(target, fs.statSync(source).mode & 0o777); }
      else fs.unlinkSync(target); // Only a validated delta in the runner-owned workspace.
    }
    if (fingerprint(workspaceSnapshot(state.worktree)) !== fingerprint(candidate)) throw Error("Restored candidate differs; no acceptance recorded");
    state.validationCandidate = { taskId, attempt: attempt.attempts, head: state.head, result, snapshot: fingerprint(candidate), executionRecord: results[0] };
    attempt.status = "ready";
    saveRun(directory, state, { type: "retained-validation-recovered", task: taskId, attempt: attempt.attempts, executionRecord: results[0], changed });
    return { task: taskId, attempt: attempt.attempts, changed, note: "Same editor result retained; resume validates and reviews without another edit invocation." };
  } finally { release(); }
}
