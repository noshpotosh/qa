import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixtures/work-repo.mjs";
import { git } from "../lib/git.mjs";
import { createRun, loadRun, saveRun } from "../scripts/work-store.mjs";
import { recoverValidation } from "../scripts/work-recovery.mjs";
import { runMilestone } from "../scripts/work-runner.mjs";

test("legacy buffer recovery retains three attempts and requires fresh validation and review", async (t) => {
  const f = fixture(t), { state, directory } = createRun(f.root, f.snapshot, f.config);
  const retained = state.worktree;
  fs.writeFileSync(path.join(retained, "src/app.mjs"), "retained fixed behavior\n");
  git(retained, ["switch", "--detach"]);
  state.worktree = path.join(state.root, ".qa-worktrees/recovered");
  git(state.root, ["worktree", "add", state.worktree, state.branch]);
  state.quarantined = [retained];
  state.states.fix = { status: "blocked", attempts: 3, key: "original", reason: "Observed validation failed" };
  state.failureKeys.original = 3;
  state.events.push({ at: new Date(Date.now() - 1000).toISOString(), type: "attempt", task: "fix", attempt: 3 });
  fs.writeFileSync(path.join(directory, "execute-00000000-0000-0000-0000-000000000000.json"), JSON.stringify({ summary: "Original editor result", evidencePaths: [] }));
  state.events.push({ at: new Date(Date.now() + 1000).toISOString(), type: "attempt-failed", task: "fix", reason: "spawnSync git ENOBUFS" });
  saveRun(directory, state);
  assert.throws(() => recoverValidation(f.root, f.config, "demo", "fix"), /Only a retained/);
  state.states.fix.reason = "spawnSync git ENOBUFS";saveRun(directory, state);
  assert.equal(recoverValidation(f.root, f.config, "demo", "fix").attempt, 3);
  let checks = 0, reviews = 0;
  const result = await runMilestone(f.root, f.config, "demo", { resume: true, executorFactory: () => ({
    doctor: async () => {}, execute: async () => assert.fail("Fourth edit invocation"),
    check: async () => { checks++;return { status: "passed", code: 0 }; },
    review: async (_m, task) => { reviews++;return { scope: "within-request", report: { status: "passed", summary: "Verified", coverage: [], findings: [] }, resolvedSources: task.criteria }; },
  }) });
  assert.equal(result.status, "completed");assert(checks >= 2);assert.equal(reviews, 1);
  const final = loadRun(f.root, "demo").state;
  assert.equal(final.states.fix.attempts, 3);assert.equal(final.failureKeys.original, 3);
  assert.equal(fs.readFileSync(path.join(f.root, "src/app.mjs"), "utf8"), "broken\n");
});
