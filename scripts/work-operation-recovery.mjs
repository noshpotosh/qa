import path from 'node:path';
import { fingerprint } from '../lib/work-plan.mjs';
import { acquireLock, storePath, loadRun, reconcileRun, saveRun } from './work-store.mjs';
import { readMilestone, authorityPaths } from './work-source.mjs';
import { resourceIdentity, workspaceSnapshot } from './work-evidence.mjs';
import { provisionInputs } from './work-sandbox.mjs';
import { CodexExecutor } from './work-codex.mjs';
import { reconcileOperation } from './work-operations.mjs';

export async function recoverOperation(root, config, id, receiptId, factory = (c, o) => new CodexExecutor(c, o)) {
  if (config.version !== 2) throw Error('Operation reconciliation requires v2');
  const release = acquireLock(storePath(root, id) + '.lock', { recover: true });
  try {
    const { state, directory } = loadRun(root, id);
    reconcileRun(state, readMilestone(root, config, id), config);
    if (state.pending || state.operatorPending) throw Error('Resolve pending checkpoint before operation recovery');
    const candidate = state.validationCandidate;
    if (!candidate || candidate.snapshot !== fingerprint(workspaceSnapshot(state.worktree))) throw Error('Retained operation candidate changed');
    const context = { workspace: state.worktree, sourceRoot: root, baseline: state.baseline, directory,
      common: path.dirname(path.dirname(directory)), codex: config.codex,
      resources: config.resources.map((r) => ({ ...r, source: path.resolve(root, r.source) })),
      readRoots: config.readRoots.map((p) => path.resolve(root, p)), protectedPaths: authorityPaths(root, config) };
    if (resourceIdentity(context.resources) !== state.inputIdentity) throw Error('Declared inputs changed');
    provisionInputs(context);
    const executor = factory(context, () => ({ timeoutMs: 60000 }));
    const result = await reconcileOperation(executor, context, state, directory, receiptId);
    if (!Object.values(state.operationReceipts).some((r) => r.status === 'pending')) state.states[candidate.taskId].status = 'ready';
    saveRun(directory, state, { type: 'operation-recovery-requested', receiptId, task: candidate.taskId });
    return result;
  } finally { release(); }
}
