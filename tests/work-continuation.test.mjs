import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/work-repo.mjs';
import { resolveWork } from '../lib/work-config.mjs';
import { git } from '../lib/git.mjs';
import { validateBindings, validateProposal } from '../lib/work-plan.mjs';
import { runMilestone } from '../scripts/work-runner.mjs';
import { loadRun } from '../scripts/work-store.mjs';

const pass = { status: 'passed', code: 0, output: 'Observed pass' };
const report = { status: 'passed', summary: 'Observed', findings: [], coverage: [] };
function setup(t, count = 2) {
  const f = fixture(t), m = f.snapshot.milestone;
  m.version = 2;
  m.prerequisites = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, criteria: ['correct'], question: `Resolve behavior ${i}`, evidence: `Observed comparison ${i}`, unlocks: 'Implement app behavior' }));
  const base = { ...m.tasks[0], operations: [], question: 'Verify behavior', purpose: 'accept', prerequisites: m.prerequisites.map((p) => p.id) };
  m.tasks = [...m.prerequisites.map((p, i) => ({ ...base, id: `prepare-${i}`, title: `Resolve ${p.id}`, kind: 'research', purpose: 'prepare', prerequisites: [p.id], checks: ['research'], priority: 10 - i })), base];
  f.config = resolveWork({ ...f.config, version: 2, continuation: 'outcome-v1', checks: { ...f.config.checks, research: { argv: ['research'], timeoutSeconds: 10 } } });
  return f;
}
function save(f) {
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [f.snapshot.milestone] }));
  git(f.root, ['add', '.qa-work.json']); git(f.root, ['commit', '-m', 'Approve continuation prerequisites']);
}
function factory(context) {
  return { doctor: async () => {}, check: async () => pass,
    execute: async (_m, task) => {
      fs.mkdirSync(path.join(context.workspace, 'evidence'), { recursive: true });
      fs.writeFileSync(path.join(context.workspace, 'evidence/result.json'), JSON.stringify({ task: task.id }));
      if (task.purpose === 'accept') fs.writeFileSync(path.join(context.workspace, 'src/app.mjs'), 'fixed\n');
      return { summary: 'Observed behavior', evidencePaths: ['evidence/result.json'] };
    },
    review: async (_m, task) => ({ scope: 'within-request', report, resolvedSources: task.purpose === 'accept' ? ['correct'] : [],
      resolvedPrerequisites: task.purpose === 'prepare' ? task.prerequisites : [], progress: { advanced: true, answer: 'Observed comparison resolves the requirement', evidencePaths: ['evidence/result.json'] } }),
    reviewPlan: async () => ({ scope: 'within-request', report }), plan: async () => { throw Error('No authorized alternative'); } };
}
test('one invocation resolves two prerequisites then implements and accepts behavior', async (t) => {
  const f = setup(t); save(f);
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: factory });
  assert.equal(r.status, 'completed'); assert.deepEqual(r.completed, ['prepare-0', 'prepare-1', 'fix']);
  const { state } = loadRun(f.root, 'demo');
  assert.equal(state.invocation.attemptsStarted, 3); assert.equal(state.invocation.status, 'completed');
  assert.equal(Object.keys(state.resolvedPrerequisites).length, 2);
  assert.equal(fs.readFileSync(path.join(state.worktree, 'src/app.mjs'), 'utf8'), 'fixed\n');
});
test('three reviewed preparation tasks stop further audits and survive resume and focus', async (t) => {
  const f = setup(t, 4); save(f);
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: factory });
  assert.equal(r.status, 'blocked'); assert.equal(r.completed.length, 3);
  assert.equal(r.continuation.preparationStreak, 3); assert.match(r.reason, /Preparation limit/);
  const next = await runMilestone(f.root, f.config, 'demo', { resume: true, focus: ['correct'], executorFactory: factory });
  assert.equal(next.completed.length, 3); assert.equal(next.continuation.preparationStreak, 3);
  assert.equal(loadRun(f.root, 'demo').state.invocation.attemptsStarted, 0);
});
test('unavailable acceptance permits prerequisite work without invoking the closed check', async (t) => {
  const f = setup(t, 1); f.config.checks.test.availability = { status: 'unavailable', reason: 'Semantic validator missing', unblock: 'Build and independently verify admission validator' }; save(f);
  let closedChecks = 0;
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...factory(c), check: async (cmd) => { if (cmd.argv[0] === 'node') closedChecks++; return pass; } }) });
  assert.deepEqual(r.completed, ['prepare-0']); assert.equal(closedChecks, 0); assert.equal(r.status, 'blocked');
  assert.equal(r.continuation.blockedChecks[0].unblock, 'Build and independently verify admission validator');
});
test('observed unavailable acceptance is not retried by renamed tasks', async (t) => {
  const f = setup(t, 0); save(f); let checks = 0;
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...factory(c),
    check: async () => { checks++; return { status: 'unavailable', code: 2, output: 'Missing semantic observation' }; },
    plan: async () => ({ tasks: [{ ...f.snapshot.milestone.tasks[0], id: 'renamed' }] }) }) });
  assert.equal(checks, 1); assert.equal(r.status, 'blocked'); assert.equal(r.continuation.blockedChecks[0].observed.output, 'Missing semantic observation');
});
test('failed task attempts consume the invocation bound', async (t) => {
  const f = setup(t, 0); f.config.tasks = 2; save(f);
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...factory(c), execute: async () => { throw Error('Concrete execution failure'); } }) });
  assert.equal(r.status, 'budget-paused'); assert.equal(loadRun(f.root, 'demo').state.states.fix.attempts, 2);
  assert.equal(r.continuation.remainingAttempts, 0);
});
test('malformed editor path retains same attempt and candidate before checks or acquisition', async (t) => {
  const f = setup(t, 0);
  f.config.operations.capture = { argv: ['capture'], timeoutSeconds: 10, inputs: ['src/app.mjs'], outputs: ['.qa-output/raw.json'], verifier: 'research', reuse: 'inputs' };
  f.snapshot.milestone.tasks[0].operations = ['capture'];
  save(f); let checks = 0;
  await assert.rejects(runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...factory(c),
    execute: async (m, task) => ({ ...await factory(c).execute(m, task), evidencePaths: ['/outside/evidence'] }),
    check: async () => { checks++; return pass; } }) }), /Malformed editor evidence paths/);
  const { state } = loadRun(f.root, 'demo'); assert.equal(state.states.fix.attempts, 1); assert(state.validationCandidate); assert(state.invalidExecutionResult); assert.equal(checks, 0);
  assert.equal(fs.readFileSync(path.join(state.worktree, 'src/app.mjs'), 'utf8'), 'fixed\n');
  await assert.rejects(runMilestone(f.root, f.config, 'demo', { resume: true, executorFactory: factory }), /Malformed editor result/);
  assert.equal(loadRun(f.root, 'demo').state.states.fix.attempts, 1);
});
test('ledger and protected metadata require opt-in and proposals cannot invent prerequisites', (t) => {
  const f = setup(t, 1), m = f.snapshot.milestone; validateBindings(m, f.config);
  assert.throws(() => resolveWork({ continuation: 'outcome-v1' }), /requires v2/);
  assert.throws(() => validateBindings(m, { ...f.config, continuation: undefined }), /requires outcome/);
  assert.throws(() => validateProposal({ tasks: [{ ...m.tasks[0], id: 'renamed', prerequisites: ['invented'] }] }, m, f.config, m.tasks), /approved prerequisites/);
  const altered = structuredClone(m); altered.prerequisites.push({ ...m.prerequisites[0], id: 'new-name' });
  assert.throws(() => validateBindings(altered, f.config), /duplicate prerequisite/);
});

test('ready acceptance outranks additional preparation once its prerequisites resolve', async (t) => {
  const f = setup(t, 4); f.snapshot.milestone.tasks.at(-1).prerequisites = ['p0', 'p1']; save(f);
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: factory });
  assert.equal(r.status, 'completed'); assert.deepEqual(r.completed, ['prepare-0', 'prepare-1', 'fix']);
});
test('closed operation verifier prevents acquisition even when its task checks pass', async (t) => {
  const f = setup(t, 1);
  f.config.checks.verify = { argv: ['verify'], timeoutSeconds: 10, availability: { status: 'unavailable', reason: 'Verifier missing', unblock: 'Review verifier proposal' } };
  f.config.operations.capture = { argv: ['capture'], timeoutSeconds: 10, inputs: ['src/app.mjs'], outputs: ['.qa-output/raw.json'], verifier: 'verify', reuse: 'inputs' };
  f.snapshot.milestone.tasks[0].operations = ['capture']; save(f); let executions = 0;
  const r = await runMilestone(f.root, f.config, 'demo', { approve: true, executorFactory: (c) => ({ ...factory(c), execute: async () => { executions++; throw Error('Must not execute'); } }) });
  assert.equal(r.status, 'blocked'); assert.equal(executions, 0);
  assert.equal(Object.keys(loadRun(f.root, 'demo').state.operationReceipts || {}).length, 0);
});
