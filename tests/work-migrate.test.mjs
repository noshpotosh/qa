import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/work-repo.mjs';
import { git } from '../lib/git.mjs';
import { fingerprint } from '../lib/work-plan.mjs';
import { resolveWork } from '../lib/work-config.mjs';
import { createRun, loadRun, saveRun } from '../scripts/work-store.mjs';
import { migrateMilestone } from '../scripts/work-migrate.mjs';

function migrationFixture(t) {
  const f = fixture(t);
  const { state, directory } = createRun(f.root, f.snapshot, f.config);
  const key = fingerprint({ criteria: ['correct'], checks: ['test'], kind: 'implementation' });
  state.states.fix = { status: 'blocked', attempts: 2, key, reason: 'Validation failed' };
  state.failureKeys[key] = 2; state.accepted.correct = { evidence: 'historic' }; state.receipts.fix = { id: 'historic' };
  saveRun(directory, state);
  const m = structuredClone(f.snapshot.milestone); m.version = 2;
  Object.assign(m.tasks[0], { purpose: 'accept', operations: [], question: 'Is behavior correct?' });
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [m] }));
  git(f.root, ['add', '.qa-work.json']); git(f.root, ['commit', '-m', 'Approve v2 target']);
  const config = resolveWork({ ...f.config, version: 2 });
  const mapping = { version: 2, expectedApproval: state.approval, expectedSourceHead: git(f.root, ['rev-parse', 'HEAD']).trim(), expectedWorkHead: state.head, tasks: m.tasks };
  return { ...f, config, state, directory, mapping };
}
test('migration preview does not mutate; apply preserves receipts and retry budgets', (t) => {
  const f = migrationFixture(t), before = fs.readFileSync(path.join(f.directory, 'state.json'), 'utf8');
  const preview = migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping });
  assert.equal(preview.applied, false); assert.equal(fs.readFileSync(path.join(f.directory, 'state.json'), 'utf8'), before);
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true }), /--approve/);
  migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true });
  const { state } = loadRun(f.root, 'demo');
  assert.equal(state.states.fix.attempts, 2); assert.equal(state.failureKeys[state.states.fix.key], 2);
  assert.deepEqual(state.receipts, f.state.receipts); assert.deepEqual(state.accepted, f.state.accepted);
  assert.equal(state.milestone.version, 2); assert.equal(state.baseline, f.mapping.expectedSourceHead);
  assert(fs.readdirSync(f.directory).some((p) => p.startsWith('migration-backup-')));
});
test('migration refuses stale identities, live processes, incomplete mappings and expanded scope', (t) => {
  const f = migrationFixture(t);
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: { ...f.mapping, expectedWorkHead: 'stale' } }), /stale/);
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: { ...f.mapping, tasks: [] } }), /mapping/);
  f.state.processes = [{ pid: process.pid }]; saveRun(f.directory, f.state);
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping }), /live processes/);
});
test('changed acceptance commands require revalidation without erasing historical acceptance', (t) => {
  const f = migrationFixture(t);
  f.config.checks.test.argv = ['node', '--test', 'new-test.mjs'];
  const preview = migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping });
  assert.deepEqual(preview.revalidation, ['correct']);
  migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true });
  const { state } = loadRun(f.root, 'demo');
  assert.equal(state.accepted.correct.evidence, 'historic'); assert.deepEqual(state.revalidation, ['correct']);
});
test('migration refuses unrelated source changes and dirty candidates', (t) => {
  const f = migrationFixture(t);
  fs.writeFileSync(path.join(f.state.worktree, 'src/app.mjs'), 'uncommitted');
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping }), /clean/);
  fs.writeFileSync(path.join(f.state.worktree, 'src/app.mjs'), 'broken\n');
  fs.writeFileSync(path.join(f.root, 'src/app.mjs'), 'outside migration');
  git(f.root, ['add', '.']); git(f.root, ['commit', '-m', 'Unrelated change']);
  f.mapping.expectedSourceHead = git(f.root, ['rev-parse', 'HEAD']).trim();
  assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping }), /non-control changes/);
});

test('interrupted migration commit is reconciled without duplicate commits or lost attempts', (t) => {
  const f = migrationFixture(t), originalRename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (from, to) => {
    if (!interrupted && path.basename(to) === 'state.json' && fs.realpathSync(path.dirname(to)) === fs.realpathSync(f.directory)) { interrupted = true; throw Error('Simulated journal interruption'); }
    return originalRename(from, to);
  };
  try { assert.throws(() => migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true }), /Simulated/); }
  finally { fs.renameSync = originalRename; }
  const committed = git(f.state.worktree, ['rev-parse', 'HEAD']).trim();
  migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true });
  assert.equal(git(f.state.worktree, ['rev-parse', 'HEAD']).trim(), committed);
  assert.equal(loadRun(f.root, 'demo').state.states.fix.attempts, 2);
});

test('migration does not manufacture capability progress or reset no-progress budget', (t) => {
  const f = migrationFixture(t);
  const current = loadRun(f.root, 'demo');
  current.state.noProgress = 3; current.state.available = ['native']; saveRun(current.directory, current.state);
  f.config.capabilities.native = { argv: ['native'], timeoutSeconds: 10, probe: true };
  migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true });
  const { state } = loadRun(f.root, 'demo');
  assert.equal(state.noProgress, 3); assert.deepEqual(state.available, ['native']);
});
test('v2 continuation adoption preserves historical attempts and preparation streak without inventing resolutions', (t) => {
  const f = migrationFixture(t);
  migrateMilestone(f.root, f.config, 'demo', { mapping: f.mapping, apply: true, approve: true });
  const { state, directory } = loadRun(f.root, 'demo');
  state.tasks[0].purpose = 'prepare';
  state.states.fix.status = 'done'; state.checkpoints = [{ task: 'fix', id: 'historical' }];
  saveRun(directory, state);
  const m = structuredClone(state.milestone);
  m.prerequisites = [{ id: 'behavior', criteria: ['correct'], question: 'What is the behavior?', evidence: 'Retained observed comparison', unlocks: 'Implement behavior' }];
  m.tasks[0].purpose = 'prepare'; m.tasks[0].prerequisites = ['behavior'];
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [m] }));
  git(f.root, ['add', '.qa-work.json']); git(f.root, ['commit', '-m', 'Approve continuation ledger']);
  const config = resolveWork({ ...f.config, continuation: 'outcome-v1' });
  const mapping = { version: 2, expectedApproval: state.approval, expectedSourceHead: git(f.root, ['rev-parse', 'HEAD']).trim(), expectedWorkHead: state.head, tasks: m.tasks };
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  const preview = migrateMilestone(f.root, config, 'demo', { mapping });
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), before);
  assert.throws(() => migrateMilestone(f.root, config, 'demo', { mapping, apply: true, approve: true }), /expectedTargetApproval/);
  mapping.expectedTargetApproval = preview.newApproval;
  migrateMilestone(f.root, config, 'demo', { mapping, apply: true, approve: true });
  const after = loadRun(f.root, 'demo').state;
  assert.equal(after.states.fix.attempts, 2); assert.equal(after.preparationStreak, 1);
  assert.deepEqual(after.resolvedPrerequisites, {}); assert.deepEqual(after.receipts, state.receipts);
});
