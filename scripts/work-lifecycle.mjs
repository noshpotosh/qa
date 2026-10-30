import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { git } from '../lib/git.mjs';
import { loadRun, storePath, acquireLock, saveRun, alive, reconcileRun } from './work-store.mjs';
import { readMilestone } from './work-source.mjs';

export function beginInvocation(state, now, deadline) {
  state.invocations ||= [];
  if (state.invocation && !state.invocation.endedAt) state.invocations.push({ ...state.invocation, status: 'interrupted', reason: 'Previous invocation has no recorded exit; cause unknown', observedAbandonedAt: now });
  else if (state.invocation) state.invocations.push(state.invocation);
  state.invocation = { id: crypto.randomUUID(), controller: { pid: process.pid, host: os.hostname() }, startedAt: now, deadline, attemptsStarted: 0, phase: 'startup', status: 'running' };
}
export function endInvocation(state, now) {
  if (!state.invocation || state.invocation.endedAt) return;
  state.elapsedMs = (state.elapsedMs || 0) + Math.max(0, now - state.invocation.startedAt);
  Object.assign(state.invocation, { endedAt: now, status: state.status, phase: 'stopped', reason: state.reason || state.planningReason || null });
}
export function lifecycleStatus(state, lock) {
  if (state.status !== 'running') return { status: state.status };
  const owner = state.invocation?.controller || lock;
  if (!owner || owner.host !== os.hostname()) return { status: 'ownership-unknown', reason: 'Controller ownership cannot be verified on this host' };
  if (alive(owner.pid) || state.processes.some((p) => alive(p.pid))) return { status: 'running' };
  return { status: 'interrupted', reason: 'Recorded controller and children are absent; exit cause unknown', recordedStatus: state.status };
}
export function readLifecycle(root, state) {
  const file = storePath(root, state.id) + '.lock';
  let lock;
  try { if (fs.existsSync(file)) lock = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { status: 'ownership-unknown', reason: 'Unreadable controller lease' }; }
  return lifecycleStatus(state, lock);
}
export function recoveryPreview(root, config, id) {
  const { state } = loadRun(root, id);
  const lifecycle = readLifecycle(root, state), blockers = [];
  if (state.status !== 'running') blockers.push('No abandoned running journal needs lifecycle recovery');
  if (['running', 'ownership-unknown'].includes(lifecycle.status)) blockers.push(lifecycle.reason || 'A recorded controller or child is live');
  try { reconcileRun(structuredClone(state), readMilestone(root, config, id), config); }
  catch (e) { blockers.push(e.message); }
  const uncertain = Object.values(state.operationReceipts || {}).filter((r) => r.status !== 'complete');
  if (uncertain.length) blockers.push('Acquisition receipts require verifier-only reconciliation before recovery');
  if (state.invalidExecutionResult) blockers.push('Malformed editor evidence paths require a reviewed result correction; candidate preserved');
  const dirty = git(state.worktree, ['status', '--porcelain', '-uall']).trim();
  if (dirty && !state.pending && !state.validationCandidate) blockers.push('Unvalidated workspace changes require review; no editor replay is safe');
  return { id, lifecycle, safe: blockers.length === 0, blockers, invocation: state.invocation || null,
    retainedCandidate: state.validationCandidate || null, pendingCheckpoint: state.pending?.id || null,
    uncertainOperations: uncertain.map((r) => r.id), nextAction: blockers.length ? 'Resolve the listed dependencies without discarding work or resetting budgets' : 'Record interrupted state, then explicitly resume for existing reconciliation and validation' };
}
export function recoverRun(root, config, id, { apply = false } = {}) {
  const preview = recoveryPreview(root, config, id);
  if (!apply) return preview;
  if (!preview.safe) throw Error(`Recovery refused: ${preview.blockers.join('; ')}`);
  const release = acquireLock(storePath(root, id) + '.lock', { recover: true });
  try {
    const { state, directory } = loadRun(root, id);
    reconcileRun(state, readMilestone(root, config, id), config);
    if (state.status !== 'running') throw Error('Only an abandoned running journal needs lifecycle recovery');
    state.status = 'interrupted';
    state.reason = preview.lifecycle.reason || 'Interrupted invocation retained for explicit resume';
    if (state.invocation && !state.invocation.endedAt) Object.assign(state.invocation, { status: 'interrupted', observedAbandonedAt: Date.now(), reason: state.reason });
    saveRun(directory, state, { type: 'interruption-reconciled', reason: state.reason });
    return { ...preview, applied: true, status: state.status };
  } finally { release(); }
}
