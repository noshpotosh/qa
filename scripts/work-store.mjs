import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { git } from "../lib/git.mjs";
import { safePath } from "../lib/install.mjs";
import { identifier, approvalIdentity } from "../lib/work-plan.mjs";

export function atomicJSON(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.pending`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
export function storePath(root, id) {
  identifier(id);
  const common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  const base = path.resolve(root, common, "qa-milestones");
  return safePath(base, id);
}
export function loadRun(root, id) {
  const directory = storePath(root, id);
  const state = JSON.parse(fs.readFileSync(safePath(directory, "state.json"), "utf8"));
  if (state.version !== 1 || state.id !== id || state.root !== fs.realpathSync(root)) throw Error("Invalid milestone journal identity");
  return { state, directory };
}
export function saveRun(directory, state, event) {
  state.updatedAt = new Date().toISOString();
  if (event) state.events.push({ at: state.updatedAt, ...event });
  atomicJSON(safePath(directory, "state.json"), state);
}
export function acquireLock(file, { recover = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  safePath(path.dirname(file), path.basename(file));
  const lease = { pid: process.pid, host: os.hostname(), nonce: crypto.randomUUID() };
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(lease)); fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!recover || previous.host !== lease.host || alive(previous.pid)) throw Error(`Resource is locked: ${file}`);
    fs.unlinkSync(file);
    return acquireLock(file);
  }
  return () => {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    if (current.nonce !== lease.nonce) throw Error("Lease ownership changed");
    fs.unlinkSync(file);
  };
}
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== "ESRCH"; }
}
export function createRun(root, snapshot, config) {
  root = fs.realpathSync(root);
  if (!config.enabled) throw Error("Milestone execution is disabled; enable work explicitly");
  if (git(root, ["status", "--porcelain", "-uall"]).trim()) throw Error("A reviewed clean Git baseline is required; existing work was preserved");
  const milestone = snapshot.milestone, directory = storePath(root, milestone.id);
  if (milestone.scope.includes("Replace this text with") || milestone.criteria.some((criterion) => criterion.description.startsWith("Replace with an observable"))) throw Error("Replace the milestone scaffold with approved scope and acceptance criteria before running");
  if (fs.existsSync(directory)) throw Error("A run already exists; use resume or status");
  const baseline = git(root, ["rev-parse", "HEAD"]).trim();
  const worktree = path.join(root, ".qa-worktrees", milestone.id);
  safePath(root, `.qa-worktrees/${milestone.id}`);
  if (fs.existsSync(worktree)) throw Error("Workspace already exists; no overwrite permitted");
  const branch = `codex/milestone-${milestone.id}-${crypto.randomBytes(4).toString("hex")}`;
  const exclude = git(root, ["rev-parse", "--git-path", "info/exclude"]).trim();
  const excludePath = path.resolve(root, exclude);
  const text = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  for (const pattern of ["/.qa-worktrees/", "/.qa-output/"]) {
    if (!text.split("\n").includes(pattern)) fs.appendFileSync(excludePath, `\n${pattern}\n`);
  }
  git(root, ["worktree", "add", "-b", branch, worktree, baseline]);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = { version: 1, id: milestone.id, root, worktree, branch, baseline, head: baseline, codeHead: baseline,
    approval: approvalIdentity(milestone, config), config, milestone, sourceRevision: snapshot.revision,
    tasks: milestone.tasks, states: {}, accepted: {}, receipts: {}, failureKeys: {},
    checkpoints: [], events: [], status: "ready", pending: null, processes: [] };
  saveRun(directory, state, { type: "approved", baseline });
  return { directory, state };
}
export function reconcileRun(state, snapshot, config) {
  if (state.approval !== approvalIdentity(snapshot.milestone, config)) throw Error("Milestone scope or execution authority changed; renewed approval required");
  if (git(state.root, ["rev-parse", "HEAD"]).trim() !== state.baseline || git(state.root, ["status", "--porcelain", "-uall"]).trim()) throw Error("Original baseline changed; existing work was preserved");
  if (state.processes.some((process) => alive(process.pid))) throw Error("A recorded owned process is still running; no task was repeated");
  const head = git(state.worktree, ["rev-parse", "HEAD"]).trim();
  if (head !== state.head) {
    const message = git(state.worktree, ["show", "-s", "--format=%B", "HEAD"]);
    const intent = state.operatorPending?.metadata && !state.operatorPending.metadata.commit ? state.operatorPending.metadata
      : state.pending?.metadata && !state.pending.metadata.commit ? state.pending.metadata : state.pending;
    if (!intent || !message.includes(`QA-Operation: ${intent.id}`) ||
        git(state.worktree, ["rev-parse", "HEAD^" ]).trim() !== state.head ||
        git(state.worktree, ["rev-parse", "HEAD^{tree}"]).trim() !== intent.tree) {
      throw Error("Workspace head changed outside the recorded operation");
    }
    state.head = head; intent.commit = head;
  }
  state.processes = [];
}
