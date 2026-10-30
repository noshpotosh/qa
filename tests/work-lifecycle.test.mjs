import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures/work-repo.mjs';
import { createRun, loadRun, saveRun } from '../scripts/work-store.mjs';
import { lifecycleStatus, recoverRun, recoveryPreview } from '../scripts/work-lifecycle.mjs';
import { resolveWork } from '../lib/work-config.mjs';
import { git } from '../lib/git.mjs';

test('lifecycle inspection distinguishes live and foreign ownership', () => {
  const state = { status: 'running', processes: [], invocation: { controller: { host: os.hostname(), pid: process.pid } } };
  assert.equal(lifecycleStatus(state).status, 'running');
  state.invocation.controller.host = 'different-host';
  assert.equal(lifecycleStatus(state).status, 'ownership-unknown');
});
test('abrupt controller termination is detected and recovered without resetting task history', async (t) => {
  const f = fixture(t); f.snapshot.milestone.version = 2;
  Object.assign(f.snapshot.milestone.tasks[0], { purpose: 'accept', operations: [], question: 'Does app work?' });
  f.config = resolveWork({ ...f.config, version: 2 });
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [f.snapshot.milestone] }));
  git(f.root, ['add', '.qa-work.json']); git(f.root, ['commit', '-m', 'V2 contract']);
  const modulePath = fileURLToPath(new URL('../scripts/work-runner.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {runMilestone} from ${JSON.stringify(modulePath)}; await runMilestone(${JSON.stringify(f.root)}, ${JSON.stringify(f.config)}, 'demo', {approve:true, executorFactory:()=>({doctor: async()=>{process.stdout.write('READY\\n'); await new Promise(()=>{setInterval(()=>{},1000)})}})});`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', (data) => { errors += data; });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`No startup: ${errors}`)), 10000);
    child.stdout.on('data', (data) => { if (String(data).includes('READY')) { clearTimeout(timer); resolve(); } });
    child.on('exit', () => { clearTimeout(timer); reject(Error(errors)); });
  });
  const { state, directory } = loadRun(f.root, 'demo');
  // Startup is an invocation too: a killed doctor must not look ready forever.
  assert.equal(state.invocation.status, 'running');
  assert.equal(state.status, 'running'); state.states.fix = { status: 'ready', attempts: 2 }; state.failureKeys.existing = 1;
  saveRun(directory, state);
  assert.equal(recoveryPreview(f.root, f.config, 'demo').safe, false);
  const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  const preview = recoverRun(f.root, f.config, 'demo');
  assert.equal(preview.lifecycle.status, 'interrupted'); assert.match(preview.lifecycle.reason, /unknown/); assert(preview.safe);
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), before);
  recoverRun(f.root, f.config, 'demo', { apply: true });
  const after = loadRun(f.root, 'demo').state;
  assert.equal(after.status, 'interrupted'); assert.equal(after.states.fix.attempts, 2); assert.equal(after.failureKeys.existing, 1);
});
test('recovery refuses changed source and uncertain acquisitions without touching state', (t) => {
  const f = fixture(t), { state, directory } = createRun(f.root, f.snapshot, f.config);
  state.status = 'unavailable'; state.operationReceipts = { capture: { id: 'capture', status: 'pending' } }; saveRun(directory, state);
  fs.writeFileSync(path.join(f.root, 'src/app.mjs'), 'user work');
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  const preview = recoveryPreview(f.root, f.config, 'demo');
  assert(!preview.safe); assert(preview.blockers.some((b) => /baseline changed/.test(b))); assert(preview.blockers.some((b) => /Acquisition/.test(b)));
  assert.throws(() => recoverRun(f.root, f.config, 'demo', { apply: true }), /Recovery refused/);
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(f.root, 'src/app.mjs'), 'utf8'), 'user work');
});
