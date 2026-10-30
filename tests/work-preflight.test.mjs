import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures/work-repo.mjs';
import { git } from '../lib/git.mjs';
import { probeCapabilities } from '../scripts/work-probes.mjs';
import { preflightMilestone } from '../scripts/work-preflight.mjs';

test('probes retain distinct diagnostics and respect dependency order', async (t) => {
  const f = fixture(t), calls = [];
  const context = { workspace: f.root, now: () => 0, deadline: 100 };
  const config = { capabilities: { dependent: { argv: ['dependent'], requires: ['socket'] }, socket: { argv: ['socket'] }, missing: { argv: ['missing'] } } };
  const result = await probeCapabilities({ check: async (c) => { calls.push(c.argv[0]); return { status: 'unavailable', code: 2, output: c.argv[0] === 'socket' ? 'EPERM socket' : 'ENOENT executable' }; } }, context, config);
  assert.deepEqual(calls, ['socket', 'missing']); assert.match(result.socket.diagnostic, /EPERM/); assert.match(result.missing.diagnostic, /ENOENT/);
  assert.match(result.dependent.diagnostic, /Required probes/);
});
test('preflight probes an isolated committed copy and never invokes acquisition or a model', async (t) => {
  const f = fixture(t), m = f.snapshot.milestone; m.version = 2;
  Object.assign(m.tasks[0], { purpose: 'accept', question: 'Correct?', operations: [] });
  fs.writeFileSync(path.join(f.root, '.qa-work.json'), JSON.stringify({ version: 2, milestones: [m] }));
  git(f.root, ['add', '.']); git(f.root, ['commit', '-m', 'V2']);
  f.config.version = 2; f.config.capabilities = { socket: { argv: ['probe'], timeoutSeconds: 10, probe: true } };
  let calls = 0;
  const r = await preflightMilestone(f.root, f.config, 'demo', (c) => ({ check: async (cmd) => {
    assert.notEqual(c.workspace, f.root); assert.equal(cmd.argv[0], 'probe'); calls++; return { status: 'passed', code: 0, output: 'Socket reachable' };
  } }));
  assert.equal(calls, 1); assert.equal(r.acquisition, 'not-executed'); assert.equal(r.status, 'passed');
  assert.equal(git(f.root, ['status', '--porcelain']).trim(), '');
});
