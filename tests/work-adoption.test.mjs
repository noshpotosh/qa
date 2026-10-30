import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixtures/work-repo.mjs";
import { initialize } from "../lib/init.mjs";
import { resolveWork } from "../lib/work-config.mjs";
import { diagnoseMilestones } from "../scripts/work-doctor.mjs";
import { createRun, reconcileRun } from "../scripts/work-store.mjs";
import { checkpointAdapterOutputs } from "../scripts/work-checkpoint.mjs";
import { git } from "../lib/git.mjs";

test("milestone setup proposes checks and preserves existing consumer configuration", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const changes = initialize(f.root, { ref: "a".repeat(40), milestones: true });
  const c = JSON.parse(changes.find((c) => c.path === ".qa.json").content);
  assert.equal(c.work.enabled, false);
  assert.deepEqual(c.work.checks["project-checks"].argv, ["npm", "test"]);
  assert(changes.find((c) => c.path === ".qa-work.json").conflict);
  assert.equal(initialize(f.root, { ref: "a".repeat(40) }).some((c) => c.path === ".qa-work.json"), false);
});
test("doctor distinguishes local plan, login and unexecuted validation", async (t) => {
  const f = fixture(t), calls = [];
  const result = await diagnoseMilestones(f.root, f.config, async (argv) => {
    calls.push(argv); return { status: "passed", output: "--ignore-user-config --output-schema" };
  });
  assert.equal(result.plan.status, "passed");
  assert.equal(result.authentication.status, "configured");
  assert.equal(result.validation.status, "not-executed");
  assert.equal(result.acceptance.status, "not-checked");
  assert.equal(calls.length, 2);
});
test("adapters cannot overwrite authority and check capabilities must be configured", () => {
  for (const file of [".qa.json", "AGENTS.md", ".github/workflows/check.yml", "package.json", "plans/work.json"]) {
    assert.throws(() => resolveWork({ plan: "plans/work.json", adapterOutputs: [file] }), /authority/);
  }
  assert.throws(() => resolveWork({ checks: { test: { argv: ["node"], timeoutSeconds: 30, requires: ["unity"] } } }), /capability/);
});
test("prepared metadata checkpoint reconciles a crash without another commit", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "evidence"));
  fs.writeFileSync(path.join(f.root, "evidence/accepted.json"), "[]\n");
  git(f.root, ["add", "."]); git(f.root, ["commit", "-m", "Seed acceptance"]);
  f.config.adapterOutputs = ["evidence/accepted.json"];
  const { state, directory } = createRun(f.root, f.snapshot, f.config);
  const operation = { id: "receipt-1", changed: [] };
  state.pending = operation;
  fs.writeFileSync(path.join(state.worktree, "evidence/accepted.json"), '["correct"]\n');
  const before = state.head;
  checkpointAdapterOutputs(state, directory, operation, ["evidence/accepted.json"]);
  const accepted = state.head;
  state.head = before; delete operation.metadata.commit;
  reconcileRun(state, f.snapshot, f.config);
  assert.equal(state.head, accepted);
  checkpointAdapterOutputs(state, directory, operation, ["evidence/accepted.json"]);
  assert.equal(git(state.worktree, ["rev-parse", "HEAD"]).trim(), accepted);
  assert.equal(fs.readFileSync(path.join(f.root, "evidence/accepted.json"), "utf8"), "[]\n");
});
