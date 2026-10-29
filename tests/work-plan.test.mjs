import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkPlan, validateProposal, selectReady, approvalIdentity, allowedChange, identifier } from "../lib/work-plan.mjs";
import { resolveWork } from "../lib/work-config.mjs";

import { milestone } from "./fixtures/work-plan.mjs";

test("work contracts reject cycles, unknown dependencies and automatic human credit", () => {
  const m = milestone(); assert.equal(validateWorkPlan({ version: 1, milestones: [m] }).version, 1);
  m.tasks[0].dependencies = ["missing"];
  assert.throws(() => validateWorkPlan({ version: 1, milestones: [m] }), /Unknown task/);
  m.tasks[0].dependencies = ["fix"];
  assert.throws(() => validateWorkPlan({ version: 1, milestones: [m] }), /cycle/);
  m.tasks[0].dependencies = []; m.tasks[0].criteria = ["feel"];
  assert.throws(() => validateWorkPlan({ version: 1, milestones: [m] }), /human tasks/);
});
test("selection continues past blocked tasks and respects dependencies and capabilities", () => {
  const m = milestone();
  m.tasks.push({ ...m.tasks[0], id: "independent", priority: 0 });
  assert.equal(selectReady(m, m.tasks, { fix: { status: "blocked" } }, [])[0].id, "independent");
  m.tasks[1].dependencies = ["fix"];
  assert.equal(selectReady(m, m.tasks, { fix: { status: "blocked" } }, []).length, 0);
  m.tasks[1].dependencies = []; m.tasks[1].capabilities = ["unity"];
  assert.equal(selectReady(m, m.tasks, { fix: { status: "blocked" } }, []).length, 0);
});
test("approval covers scope and authority but excludes routine acceptance progress", () => {
  const m = milestone(), config = resolveWork(), identity = approvalIdentity(m, config);
  m.criteria[0].done = true; m.criteria[0].evidence = ["new proof"];
  assert.equal(approvalIdentity(m, config), identity);
  m.scope += " Expanded scope";
  assert.notEqual(approvalIdentity(m, config), identity);
});
test("derived tasks cannot rename known tasks, add criteria or request new checks", () => {
  const m = milestone(), config = resolveWork({ checks: { test: { argv: ["node", "--test"], timeoutSeconds: 30 } } });
  const task = { ...m.tasks[0], id: "another" };
  assert.equal(validateProposal({ tasks: [task] }, m, config, m.tasks).length, 1);
  assert.throws(() => validateProposal({ tasks: [m.tasks[0]] }, m, config, m.tasks), /replace/);
  task.criteria = ["outside"];
  assert.throws(() => validateProposal({ tasks: [task] }, m, config, m.tasks), /unknown criteria/);
});
test("scope checks protect controls even when allowedPaths is broad", () => {
  const m = { ...milestone(), allowedPaths: ["**"] };
  for (const file of [".qa-work.json", ".github/workflows/a.yml", "src/AGENTS.md", "../outside"]) {
    try { assert.equal(allowedChange(file, m), false); } catch (error) { assert.match(error.message, /safe repository/); }
  }
  assert.equal(allowedChange("src/main.mjs", m), true);
});
test("configuration requires literal commands and bounds retries", () => {
  assert.throws(() => resolveWork({ checks: { test: "npm test" } }));
  assert.throws(() => resolveWork({ attempts: 4 }));
  assert.throws(() => resolveWork({ resources: [{ id: "x", source: "/tmp", target: "../escape" }] }));
  for (const name of ["constructor", "toString", "prototype"]) assert.throws(() => identifier(name));
});
