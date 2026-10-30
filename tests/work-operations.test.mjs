import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/work-repo.mjs';
import { runOperations, reconcileOperation } from '../scripts/work-operations.mjs';

function setup(t, reuse = 'inputs') {
  const f = fixture(t), directory = path.join(f.root, '.journal');
  fs.mkdirSync(directory); fs.mkdirSync(path.join(f.root, '.qa-output'));
  fs.appendFileSync(path.join(f.root, '.git/info/exclude'), '\n/.qa-output/\n/.journal/\n');
  const state = { events: [], states: { research: { attempts: 1 } }, config: { operations: { capture: {
    argv: ['capture'], timeoutSeconds: 30, inputs: ['src/app.mjs'], outputs: ['.qa-output/capture.json'], verifier: 'verify', reuse,
  } }, checks: { verify: { argv: ['verify'], timeoutSeconds: 30 } } } };
  const context = { workspace: f.root, resources: [], protectedPaths: [], now: () => 0, deadline: 100 };
  let captures = 0, failVerify = false;
  const executor = { check: async (cmd) => {
    if (cmd.argv[0] === 'capture') { captures++; fs.writeFileSync(path.join(f.root, '.qa-output/capture.json'), '{"sample":42}'); }
    return { status: failVerify && cmd.argv[0] === 'verify' ? 'failed' : 'passed', code: 0 };
  } };
  const task = { id: 'research', operations: ['capture'] };
  return { ...f, state, context, executor, directory, task, captures: () => captures, fail: (v) => { failVerify = v; } };
}
test('operation receipt reuses exact inputs across analysis edits, but invalidates changed inputs', async (t) => {
  const f = setup(t); const run = () => runOperations(f.executor, f.context, f.state, f.directory, f.task);
  await run(); fs.writeFileSync(path.join(f.root, 'notes.md'), 'Unrelated analysis');
  fs.unlinkSync(path.join(f.root, '.qa-output/capture.json'));
  assert.equal((await run())[0].reused, true); assert.equal(f.captures(), 1);
  fs.writeFileSync(path.join(f.root, 'src/app.mjs'), 'changed input');
  assert.equal((await run())[0].reused, false); assert.equal(f.captures(), 2);
});
test('uncertain operation survives reload and reconciliation never repeats acquisition', async (t) => {
  const f = setup(t); f.fail(true);
  await assert.rejects(runOperations(f.executor, f.context, f.state, f.directory, f.task), /verifier/);
  const state = JSON.parse(fs.readFileSync(path.join(f.directory, 'state.json')));
  f.fail(false);
  await assert.rejects(runOperations(f.executor, f.context, state, f.directory, f.task), /uncertain outcome/);
  const receipt = Object.values(state.operationReceipts)[0];
  assert.equal((await reconcileOperation(f.executor, f.context, state, f.directory, receipt.receiptId)).status, 'complete');
  await runOperations(f.executor, f.context, state, f.directory, f.task);
  assert.equal(f.captures(), 1);
});
test('corrupt retained output stops reuse without silently acquiring again', async (t) => {
  const f = setup(t); await runOperations(f.executor, f.context, f.state, f.directory, f.task);
  const receipt = Object.values(f.state.operationReceipts)[0];
  fs.writeFileSync(path.join(f.directory, receipt.artifacts[0].storedPath), 'corrupt');
  await assert.rejects(runOperations(f.executor, f.context, f.state, f.directory, f.task), /corrupt/);
  assert.equal(f.captures(), 1);
});
test('fresh operations reuse same-attempt validation, but execute again on a new attempt', async (t) => {
  const f = setup(t, 'fresh'); const run = () => runOperations(f.executor, f.context, f.state, f.directory, f.task);
  await run(); await run(); assert.equal(f.captures(), 1);
  f.state.states.research.attempts++; await run(); assert.equal(f.captures(), 2);
});
