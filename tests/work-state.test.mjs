import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/git.mjs";
import { resolveWork } from "../lib/work-config.mjs";
import { createRun, loadRun, saveRun, acquireLock, reconcileRun } from "../scripts/work-store.mjs";
import { startAttempt, failAttempt } from "../lib/work-state.mjs";

import { fixture } from "./fixtures/work-repo.mjs";

test("run creation preserves the original checkout and refuses dirty baselines", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "untracked.txt"), "preserve me");
  assert.throws(() => createRun(f.root, f.snapshot, f.config), /clean Git/);
  fs.unlinkSync(path.join(f.root, "untracked.txt"));
  const { directory, state } = createRun(f.root, f.snapshot, f.config);
  assert.equal(git(f.root, ["branch", "--show-current"]).trim(), "main");
  assert.equal(git(f.root, ["status", "--porcelain"]).trim(), "");
  assert.equal(loadRun(f.root, "demo").state.head, state.head);
  startAttempt(state, state.tasks[0]); failAttempt(state, state.tasks[0], "failed");
  saveRun(directory, state, { type: "failed" });
  const resumed = loadRun(f.root, "demo").state;
  assert.equal(resumed.states.fix.attempts, 1);
  reconcileRun(resumed, f.snapshot, f.config);
  resumed.states.fix.attempts = 3;
  assert.throws(() => startAttempt(resumed, resumed.tasks[0]), /exhausted/);
});
test("scope changes and external commits cannot be silently resumed", (t) => {
  const f = fixture(t), { state } = createRun(f.root, f.snapshot, f.config);
  const changed = structuredClone(f.snapshot); changed.milestone.scope += " more work";
  assert.throws(() => reconcileRun(state, changed, f.config), /renewed approval/);
  git(state.worktree, ["commit", "--allow-empty", "-m", "External change"]);
  assert.throws(() => reconcileRun(state, f.snapshot, f.config), /outside/);
});
test("exclusive leases cannot be stolen from a live process", (t) => {
  const f = fixture(t), file = path.join(f.root, "lease");
  const release = acquireLock(file);
  assert.throws(() => acquireLock(file, { recover: true }), /locked/);
  release();
  const again = acquireLock(file); again();
});
test("resume recognizes an interrupted recorded commit without duplicating it", (t) => {
  const f = fixture(t), { state, directory } = createRun(f.root, f.snapshot, f.config);
  fs.writeFileSync(path.join(state.worktree, "src/app.mjs"), "fixed\n");
  git(state.worktree, ["add", "src/app.mjs"]);
  const tree = git(state.worktree, ["write-tree"]).trim();
  state.pending = { id: "op-1", taskId: "fix", tree };
  saveRun(directory, state);
  git(state.worktree, ["commit", "-m", "Fix demo\n\nQA-Operation: op-1"]);
  const resumed = loadRun(f.root, "demo").state;
  reconcileRun(resumed, f.snapshot, f.config);
  assert.equal(resumed.head, git(state.worktree, ["rev-parse", "HEAD"]).trim());
  assert.equal(resumed.pending.commit, resumed.head);
});
