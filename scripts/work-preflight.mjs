import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../lib/git.mjs';
import { validateBindings } from '../lib/work-plan.mjs';
import { readMilestone, authorityPaths } from './work-source.mjs';
import { CodexExecutor } from './work-codex.mjs';
import { provisionInputs } from './work-sandbox.mjs';
import { probeCapabilities } from './work-probes.mjs';

export async function preflightMilestone(root, config, id, executorFactory = (c, o) => new CodexExecutor(c, o)) {
  if (config.version !== 2) throw Error('Explicit non-destructive probes require a v2 contract');
  const snapshot = readMilestone(root, config, id); validateBindings(snapshot.milestone, config);
  if (git(root, ['status', '--porcelain', '-uall']).trim()) throw Error('Preflight requires a clean committed contract');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-preflight-'));
  try {
    const workspace = path.join(temporary, 'workspace');
    git(root, ['clone', '--local', '--no-hardlinks', '--no-checkout', root, workspace]);
    git(workspace, ['checkout', '--detach', git(root, ['rev-parse', 'HEAD']).trim()]);
    const context = { workspace, sourceRoot: root, baseline: git(workspace, ['rev-parse', 'HEAD']).trim(),
      directory: path.join(temporary, 'controller'), common: path.join(workspace, '.git'), codex: config.codex,
      resources: config.resources.map((r) => ({ ...r, source: path.resolve(root, r.source) })),
      readRoots: config.readRoots.map((p) => path.resolve(root, p)), protectedPaths: authorityPaths(root, config),
      now: Date.now, deadline: Date.now() + config.minutes * 60000 };
    fs.mkdirSync(context.directory); provisionInputs(context);
    const options = () => ({ timeoutMs: Math.max(1, context.deadline - Date.now()) });
    const executor = executorFactory(context, options);
    // Uses the real command sandbox, but does not require a model call or login.
    const probes = await probeCapabilities(executor, context, config);
    return { version: 2, milestone: id, sourceHead: context.baseline, probes,
      status: Object.values(probes).every((p) => p.status === 'passed') ? 'passed' : 'unavailable',
      acceptance: 'not-assessed', acquisition: 'not-executed' };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
