import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fingerprint } from '../lib/work-plan.mjs';
import { safePath } from '../lib/install.mjs';
import { captureArtifacts, retainArtifacts, fileHash, resourceIdentity, workspaceSnapshot } from './work-evidence.mjs';
import { saveRun } from './work-store.mjs';

function operationKey(context, state, id) {
  const operation = state.config.operations[id];
  const inputs = captureArtifacts(context.workspace, operation.inputs);
  const controls = captureArtifacts(context.workspace, [...new Set(context.protectedPaths)].filter((p) => fs.existsSync(path.join(context.workspace, p))));
  return fingerprint({ id, operation, verifier: state.config.checks[operation.verifier], inputs, controls,
    resources: resourceIdentity(context.resources) });
}
function commandOf(operation) {
  const { inputs, verifier, reuse, ...command } = operation;
  return command;
}
function uncertain(message) {
  return Object.assign(Error(message), { terminal: true, unavailable: true, operationUncertain: true });
}
function restore(context, directory, receipt) {
  for (const artifact of receipt.artifacts) {
    const stored = safePath(directory, artifact.storedPath);
    if (fileHash(stored) !== artifact.sha256) throw uncertain('Retained operation output is corrupt; reconcile before acquisition');
    const destination = safePath(context.workspace, artifact.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(stored, destination);
  }
}
async function verify(executor, context, state, id, key) {
  const before = fingerprint(workspaceSnapshot(context.workspace));
  const acquired = captureArtifacts(context.workspace, state.config.operations[id].outputs);
  const result = await executor.check(state.config.checks[state.config.operations[id].verifier]);
  if (fingerprint(captureArtifacts(context.workspace, state.config.operations[id].outputs)) !== fingerprint(acquired)) throw uncertain('Verifier modified acquired evidence');
  if (result.status !== 'passed') throw uncertain(`Operation verifier did not pass: ${id}`);
  if (operationKey(context, state, id) !== key || fingerprint(workspaceSnapshot(context.workspace)) !== before) throw uncertain('Operation verification changed source or inputs');
  return result;
}
export async function runOperations(executor, context, state, directory, task) {
  const results = [];
  state.operationReceipts ||= {};
  for (const id of task.operations || []) {
    const operation = state.config.operations[id], key = operationKey(context, state, id);
    const prior = Object.values(state.operationReceipts).find((r) => r.id === id && r.status === 'pending');
    if (prior) throw uncertain(`Operation ${id} has an uncertain outcome (${prior.receiptId}); reconcile it before retry`);
    const previous = state.operationReceipts[key];
    if (previous?.status === 'complete' && (operation.reuse === 'inputs' || previous.attempt === state.states[task.id].attempts && previous.task === task.id)) {
      restore(context, directory, previous);
      const check = await verify(executor, context, state, id, key);
      previous.reuses++;
      saveRun(directory, state, { type: 'operation-reused', id, key });
      results.push({ id, key, reused: true, artifacts: previous.artifacts, check }); continue;
    }
    if (context.signal?.aborted || context.now() >= context.deadline) throw Error('Operation budget expired or interrupted');
    const receipt = { receiptId: crypto.randomUUID(), id, key, task: task.id, attempt: state.states[task.id].attempts,
      status: 'pending', executions: (previous?.executions || 0) + 1, reuses: previous?.reuses || 0, artifacts: [] };
    // Keep historical receipts even when a fresh operation repeats identical inputs.
    if (previous) (state.operationHistory ||= []).push(previous);
    state.operationReceipts[key] = receipt;
    saveRun(directory, state, { type: 'operation-intent', id, key, receiptId: receipt.receiptId });
    const source = fingerprint(workspaceSnapshot(context.workspace));
    for (const name of operation.outputs) {
      const output = safePath(context.workspace, name);
      if (fs.existsSync(output)) { if (!fs.lstatSync(output).isFile()) throw uncertain('Operation output is not a regular file'); fs.unlinkSync(output); }
    }
    try {
      const result = await executor.check(commandOf(operation));
      if (result.status !== 'passed') throw uncertain(`Operation ${id} did not report success; do not repeat automatically`);
      if (operationKey(context, state, id) !== key || fingerprint(workspaceSnapshot(context.workspace)) !== source) throw uncertain('Operation changed source or declared inputs');
      receipt.artifacts = retainArtifacts(context.workspace, directory, receipt.receiptId, captureArtifacts(context.workspace, operation.outputs));
      saveRun(directory, state, { type: 'operation-output-retained', id, key });
      const check = await verify(executor, context, state, id, key);
      receipt.status = 'complete'; receipt.check = check;
      saveRun(directory, state, { type: 'operation-completed', id, key });
      results.push({ id, key, reused: false, artifacts: receipt.artifacts, check });
    } catch (error) { throw uncertain(error.message); }
  }
  return results;
}
// Reconciliation validates already retained output; it never executes acquisition.
export async function reconcileOperation(executor, context, state, directory, receiptId) {
  const receipt = Object.values(state.operationReceipts || {}).find((r) => r.receiptId === receiptId);
  if (!receipt || receipt.status !== 'pending' || !receipt.artifacts.length) throw Error('No complete retained output to reconcile; manual investigation required');
  if (operationKey(context, state, receipt.id) !== receipt.key) throw Error('Operation inputs changed; cannot reconcile');
  restore(context, directory, receipt);
  receipt.check = await verify(executor, context, state, receipt.id, receipt.key);
  receipt.status = 'complete';
  saveRun(directory, state, { type: 'operation-reconciled', receiptId });
  return { receiptId, status: receipt.status, acquisition: 'not-executed' };
}
