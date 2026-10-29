import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fixture } from "./fixtures/work-repo.mjs";
import { runMilestone } from "../scripts/work-runner.mjs";
import { loadRun } from "../scripts/work-store.mjs";
import { git } from "../lib/git.mjs";
import { acceptCriterion } from "../scripts/work-operator.mjs";

const report = () => ({ status: "passed", summary: "Bounded task verified", coverage: [], findings: [] });
function fake(context, { fail = false, expanded = false, interrupt } = {}) {
  return {
    doctor: async () => {},
    execute: async (_m, task) => {
      fs.writeFileSync(path.join(context.workspace, "src/app.mjs"), "console.log('fixed');\n");
      if (interrupt) interrupt();
      return { summary: task.title, evidencePaths: [] };
    },
    check: async () => ({ status: fail ? "failed" : "passed", code: fail ? 1 : 0, output: "Observed process output" }),
    review: async (_m, task) => ({ report: report(), scope: expanded ? "expanded" : "within-request", resolvedSources: task.criteria }),
    plan: async () => { throw Error("Unexpected planning"); },
  };
}
function savePlan(f) {
  fs.writeFileSync(path.join(f.root, ".qa-work.json"), JSON.stringify({ version: 1, milestones: [f.snapshot.milestone] }));
  git(f.root, ["add", ".qa-work.json"]); git(f.root, ["commit", "-m", "Configure approved plan"]);
}
test("runner executes, validates, reviews and commits without changing the original checkout", async (t) => {
  const f = fixture(t);
  const result = await runMilestone(f.root, f.config, "demo", { approve: true, executorFactory: fake });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.completed, ["fix"]);
  assert.equal(fs.readFileSync(path.join(f.root, "src/app.mjs"), "utf8"), "broken\n");
  const { state } = loadRun(f.root, "demo");
  assert.equal(state.checkpoints.length, 1);
  assert.notEqual(state.head, state.baseline);
  assert.equal(state.receipts.fix.checks[0].code, 0);
  assert.equal(git(f.root, ["status", "--porcelain"]).trim(), "");
  const resumed = await runMilestone(f.root, f.config, "demo", { resume: true, executorFactory: () => ({ ...fake({}), execute: () => assert.fail("Completed task repeated") }) });
  assert.equal(resumed.status, "completed");
  assert.equal(loadRun(f.root, "demo").state.checkpoints.length, 1);
});
test("three failing attempts remain exhausted across resume", async (t) => {
  const f = fixture(t), options = { executorFactory: (context) => fake(context, { fail: true }) };
  const result = await runMilestone(f.root, f.config, "demo", { ...options, approve: true });
  assert.equal(result.status, "blocked");
  assert.equal(loadRun(f.root, "demo").state.states.fix.attempts, 3);
  await runMilestone(f.root, f.config, "demo", { ...options, resume: true });
  assert.equal(loadRun(f.root, "demo").state.states.fix.attempts, 3);
});
test("blocked candidate is preserved separately while independent tasks proceed", async (t) => {
  const f = fixture(t), m = f.snapshot.milestone;
  m.criteria.push({ id: "second", description: "Second behavior", kind: "automated", done: false, checks: ["test"], evidence: [] });
  m.tasks.push({ ...m.tasks[0], id: "second", criteria: ["second"], priority: 0 });
  savePlan(f);
  const result = await runMilestone(f.root, f.config, "demo", { approve: true, executorFactory: (context) => {
    const actor = fake(context);
    actor.review = async (_m, task) => ({ report: report(), scope: task.id === "fix" ? "expanded" : "within-request", resolvedSources: task.criteria });
    return actor;
  } });
  assert(result.completed.includes("second"));
  assert(result.blocked.some((task) => task.id === "fix"));
  assert.equal(loadRun(f.root, "demo").state.quarantined.length, 1);
});
test("verification-only work can complete without a fabricated code change", async (t) => {
  const f = fixture(t);
  const result = await runMilestone(f.root, f.config, "demo", { approve: true, executorFactory: (context) => ({
    ...fake(context), execute: async () => ({ summary: "Observed verification", evidencePaths: [] }),
    check: async () => {
      const output = execFileSync(process.execPath, ["-e", "console.log('real check')"], { encoding: "utf8" });
      return { status: "passed", code: 0, output };
    },
  }) });
  assert.equal(result.status, "completed");
  const { state } = loadRun(f.root, "demo");
  assert.equal(state.head, state.baseline);
  assert.match(state.receipts.fix.checks[0].output, /real check/);
});
test("human criteria produce one handoff and cannot be credited by a worker", async (t) => {
  const f = fixture(t);
  f.snapshot.milestone.criteria.push({ id: "hands-on", description: "Accept on matching device build", kind: "human", done: false, checks: [], evidence: [] });
  savePlan(f);
  const result = await runMilestone(f.root, f.config, "demo", { approve: true, executorFactory: fake });
  assert.equal(result.status, "awaiting-human");
  assert.equal(result.human[0].id, "hands-on");
  assert.deepEqual(result.completed, ["fix"]);
  const { state, directory } = loadRun(f.root, "demo"), evidence = path.join(directory, "operator.json");
  fs.writeFileSync(evidence, JSON.stringify({ version: 1, criterionId: "hands-on", sourceHead: state.baseline, buildId: "build-1", observation: "Checked on device" }));
  assert.throws(() => acceptCriterion(f.root, f.config, "demo", "hands-on", evidence), /matching sourceHead/);
  fs.writeFileSync(evidence, JSON.stringify({ version: 1, criterionId: "hands-on", sourceHead: state.head, buildId: "build-2", observation: "Checked on matching device build" }));
  assert.equal(acceptCriterion(f.root, f.config, "demo", "hands-on", evidence).kind, "human-attested");
  const completed = await runMilestone(f.root, f.config, "demo", { resume: true, executorFactory: fake });
  assert.equal(completed.status, "completed");
});
test("a budget boundary checkpoints partial work and resumes without resetting attempts", async (t) => {
  const f = fixture(t); let clock = 0;
  const first = await runMilestone(f.root, f.config, "demo", { approve: true, now: () => clock,
    executorFactory: (context) => fake(context, { interrupt: () => { clock = 121 * 60000; } }) });
  assert.equal(first.status, "budget-paused");
  assert.equal(loadRun(f.root, "demo").state.states.fix.attempts, 1);
  const next = await runMilestone(f.root, f.config, "demo", { resume: true, executorFactory: fake });
  assert.equal(next.status, "completed");
  assert.equal(loadRun(f.root, "demo").state.states.fix.attempts, 2);
});
