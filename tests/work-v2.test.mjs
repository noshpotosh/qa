import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/work-repo.mjs';
import { git } from '../lib/git.mjs';
import { resolveWork } from '../lib/work-config.mjs';
import { validateWorkPlan, taskChecks } from '../lib/work-plan.mjs';
import { runMilestone } from '../scripts/work-runner.mjs';
import { loadRun } from '../scripts/work-store.mjs';

export function v2Fixture(t) {
  const f = fixture(t), m = f.snapshot.milestone;
  m.version = 2;
  Object.assign(m.tasks[0], { purpose: 'accept', operations: [], question: 'Does the app behave correctly?' });
  f.config = resolveWork({ ...f.config, version: 2 });
  saveV2(f);
  return f;
}
function saveV2(f) {
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [f.snapshot.milestone] }));
  git(f.root, ['add', '.qa-work.json']); git(f.root, ['commit', '-m', 'Define v2 contract']);
}
const passed = { status: 'passed', code: 0, output: 'Observed pass' };
const report = { status: 'passed', summary: 'Reviewed', coverage: [], findings: [] };
const review = (resolvedSources = [], advanced = false) => ({ scope: 'within-request', report, resolvedSources,
  progress: { advanced, answer: advanced ? 'Retained observation answers the question' : '', evidencePaths: advanced ? ['evidence/observation.json'] : [] } });
function executor(context) {
  return { doctor: async () => {}, check: async () => passed,
    execute: async () => { fs.mkdirSync(path.join(context.workspace, 'evidence'), { recursive: true });
      fs.writeFileSync(path.join(context.workspace, 'evidence/observation.json'), '{"observed":true}');
      return { summary: 'Observed behavior', evidencePaths: ['evidence/observation.json'] }; },
    review: async (_m, task) => review(task.purpose === 'accept' ? task.criteria : [], true),
    reviewPlan: async () => ({ scope: 'within-request', report }), plan: async () => { throw Error('No further proposal'); } };
}
test('v2 preparation runs with unavailable acceptance checks and cannot credit the criterion', async (t) => {
  const f = v2Fixture(t), m = f.snapshot.milestone;
  m.tasks[0].purpose = 'prepare'; m.tasks[0].checks = ['research'];
  f.config.checks.research = { argv: ['research'], timeoutSeconds: 10 };
  f.config.checks.test.requires = ['native'];
  f.config.capabilities.native = { argv: ['native'], timeoutSeconds: 10, probe: true };
  saveV2(f);
  const result = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (context) => ({ ...executor(context),
    check: async (command) => command.argv[0] === 'native' ? { status: 'unavailable', code: 2 } : passed }) });
  assert.deepEqual(result.completed, ['fix']); assert.equal(result.status, 'blocked');
  assert.deepEqual(loadRun(f.root, 'demo').state.accepted, {});
  assert.deepEqual(taskChecks(m.tasks[0], m), ['research']);
});
test('v2 preparation rejects a reviewer trying to grant acceptance', async (t) => {
  const f = v2Fixture(t); f.snapshot.milestone.tasks[0].purpose = 'prepare'; saveV2(f);
  const result = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...executor(c), review: async () => review(['correct'], true) }) });
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.completed, []);
  assert.match(result.blocked[0].reason, /Preparation cannot/);
});
test('v2 planner sees blocked acceptance criteria and can propose research', async (t) => {
  const f = v2Fixture(t), m = f.snapshot.milestone;
  const prepared = { ...m.tasks[0], id: 'research', purpose: 'prepare', checks: ['research'] };
  f.config.checks.research = { argv: ['research'], timeoutSeconds: 10 };
  f.config.checks.test.requires = ['native']; f.config.capabilities.native = { argv: ['native'], timeoutSeconds: 10, probe: true };
  let plans = 0;
  const result = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...executor(c),
    check: async (cmd) => cmd.argv[0] === 'native' ? { status: 'unavailable', code: 2 } : passed,
    plan: async (milestone) => { assert.equal(milestone.criteria[0].id, 'correct'); if (plans++) throw Error('No further proposal'); return { tasks: [prepared] }; } }) });
  assert.deepEqual(result.completed, ['research']); assert.equal(result.status, 'blocked');
});
test('v1 rejects v2 task fields and v2 requires explicit purpose and question', (t) => {
  const f = fixture(t), m = f.snapshot.milestone;
  m.tasks[0].purpose = 'prepare'; assert.throws(() => validateWorkPlan({ version: 1, milestones: [m] }), /Invalid task/);
  m.version = 2; assert.throws(() => validateWorkPlan({ version: 2, milestones: [m] }), /V2 tasks/);
});
test('v2 file churn without reviewed progress stops after three checkpoints', async (t) => {
  const f = v2Fixture(t), m = f.snapshot.milestone; m.tasks[0].purpose = 'prepare';
  m.tasks = [0, 1, 2, 3].map((i) => ({ ...m.tasks[0], id: `prepare-${i}` })); saveV2(f);
  const result = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...executor(c),
    execute: async (_m, task) => { fs.writeFileSync(path.join(c.workspace, 'src/app.mjs'), `// ${task.id}`); return { summary: 'Reworded', evidencePaths: [] }; },
    review: async () => review() }) });
  assert.equal(result.completed.length, 3); assert.equal(loadRun(f.root, 'demo').state.noProgress, 3);
});
