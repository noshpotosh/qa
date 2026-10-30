import { outcomeMode } from '../lib/work-continuation.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git } from '../lib/git.mjs';
import { approvalIdentity, fingerprint, validateTask, validateGraph, validateBindings } from '../lib/work-plan.mjs';
import { safePath } from '../lib/install.mjs';
import { readMilestone, authorityPaths } from './work-source.mjs';
import { acquireLock, storePath, loadRun, atomicJSON, alive } from './work-store.mjs';
import { workspaceSnapshot } from './work-evidence.mjs';

function buildMigration(root, config, id, mapping) {
  const { state, directory } = loadRun(root, id);
  const adoptingContinuation = state.milestone.version === 2 && !outcomeMode(state.config) && outcomeMode(config);
  if (config.version !== 2 || mapping.version !== 2 || (state.milestone.version === 2 && !adoptingContinuation)) throw Error('Migration requires a v1 journal or explicit v2 continuation adoption and a committed v2 target');
  if (state.processes.some((p) => alive(p.pid)) || state.pending || state.operatorPending || state.validationCandidate || Object.values(state.operationReceipts || {}).some((r) => r.status === 'pending')) throw Error('Resolve live processes or pending operations before migration');
  const sourceHead = git(root, ['rev-parse', 'HEAD']).trim();
  if (mapping.expectedApproval !== state.approval || mapping.expectedSourceHead !== sourceHead || mapping.expectedWorkHead !== state.head) throw Error('Migration preview identities are stale');
  if (git(root, ['status', '--porcelain', '-uall']).trim() || git(state.worktree, ['status', '--porcelain', '-uall']).trim()) throw Error('Migration requires clean source and owned worktree');
  if (git(state.worktree, ['rev-parse', 'HEAD']).trim() !== state.head) throw Error('Concurrent worktree change');
  git(root, ['merge-base', '--is-ancestor', state.baseline, sourceHead]);
  const snapshot = readMilestone(root, config, id), milestone = snapshot.milestone;
  validateBindings(milestone, config);
  if (milestone.scope !== state.milestone.scope || fingerprint(milestone.allowedPaths) !== fingerprint(state.milestone.allowedPaths) ||
      fingerprint(milestone.criteria.map(({ id, description, kind }) => ({ id, description, kind }))) !== fingerprint(state.milestone.criteria.map(({ id, description, kind }) => ({ id, description, kind })))) throw Error('Migration cannot expand approved scope or rewrite criteria');
  if (!Array.isArray(mapping.tasks) || new Set(mapping.tasks.map((t) => t.id)).size !== mapping.tasks.length || mapping.tasks.length !== state.tasks.length) throw Error('Explicit mapping required for every existing task');
  for (const task of mapping.tasks) {
    validateTask(task, milestone);
    const old = state.tasks.find((t) => t.id === task.id);
    if (!old || fingerprint(task.criteria) !== fingerprint(old.criteria) || task.kind !== old.kind || fingerprint(task.dependencies) !== fingerprint(old.dependencies)) throw Error('Migration must preserve task identity, kind, dependencies and criteria');
  }
  const tasks = [...mapping.tasks, ...milestone.tasks.filter((t) => !state.tasks.some((old) => old.id === t.id))];
  validateGraph(tasks); validateBindings({ ...milestone, tasks }, config);
  for (const task of milestone.tasks) if (fingerprint(tasks.find((t) => t.id === task.id)) !== fingerprint(task)) throw Error('Task mapping conflicts with committed target plan');
  const controls = new Set(['.qa.json', ...authorityPaths(root, state.config), ...authorityPaths(root, config)]);
  const changed = git(root, ['diff', '--name-only', '-z', state.baseline, sourceHead]).split('\0').filter(Boolean);
  if (changed.some((p) => !controls.has(p))) throw Error('Source baseline has non-control changes; migrate on a dedicated control-only commit');
  const entries = changed.map((name) => {
    const file = safePath(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Error('Migration cannot delete controls');
    return { path: name, content: fs.readFileSync(file).toString('base64'), mode: fs.statSync(file).mode & 0o777 };
  });
  const next = structuredClone(state);
  next.baseline = sourceHead; next.config = config; next.milestone = milestone; next.tasks = tasks;
  next.approval = approvalIdentity(milestone, config); next.sourceRevision = snapshot.revision;
  next.revalidation ||= [];
  for (const criterion of milestone.criteria) {
    const old = state.milestone.criteria.find((c) => c.id === criterion.id);
    const signature = (c, settings) => fingerprint({ checks: c.checks, commands: c.checks.map((id) => settings.checks[id]) });
    if (signature(old, state.config) !== signature(criterion, config)) next.revalidation.push(criterion.id);
  }
  next.revalidation = [...new Set(next.revalidation)];
  for (const task of tasks) {
    const attempt = next.states[task.id]; if (!attempt) continue;
    const key = fingerprint({ criteria: [...task.criteria].sort(), checks: [...task.checks].sort(), kind: task.kind });
    next.failureKeys[key] = Math.max(next.failureKeys[key] || 0, next.failureKeys[attempt.key] || 0);
    attempt.key = key;
  }
  if (outcomeMode(config)) {
    next.resolvedPrerequisites = {}; // Historical research is not retrospective prerequisite acceptance.
    next.preparationStreak = 0;
    for (const checkpoint of [...state.checkpoints].reverse()) {
      const task = state.tasks.find((t) => t.id === checkpoint.task);
      if (task?.purpose !== 'prepare' || state.receipts[task.id]?.operations?.length) break;
      next.preparationStreak++;
    }
  }
  next.available = (state.available || []).filter((id) => Object.hasOwn(config.capabilities, id)); next.probes = {}; next.finalChecks = null;
  return { state, next, directory, entries, sourceHead, sourceSnapshot: fingerprint(workspaceSnapshot(root)), workFiles: workspaceSnapshot(state.worktree), workSnapshot: fingerprint(workspaceSnapshot(state.worktree)) };
}
export function migrateMilestone(root, config, id, { mapping, apply = false, approve = false } = {}) {
  if (apply && !approve) throw Error('Migration apply requires --approve');
  const release = apply ? acquireLock(storePath(root, id) + '.lock', { recover: true }) : () => {};
  try {
    const transactionFile = path.join(storePath(root, id), 'migration.pending.json');
    let transaction;
    if (fs.existsSync(transactionFile)) {
      if (!apply) throw Error('Pending migration exists; repeat approved apply to reconcile');
      transaction = JSON.parse(fs.readFileSync(transactionFile));
    } else {
      const proposal = buildMigration(root, config, id, mapping);
      if (!apply) return { version: 2, applied: false, sourceHead: proposal.sourceHead, workHead: proposal.state.head,
        oldApproval: proposal.state.approval, newApproval: proposal.next.approval, tasks: proposal.next.tasks,
        revalidation: proposal.next.revalidation, changedControls: proposal.entries.map((e) => e.path), preserved: ['attempts', 'failureKeys', 'receipts', 'checkpoints', 'tracker bindings'] };
      if (outcomeMode(proposal.next.config) && mapping.expectedTargetApproval !== proposal.next.approval) throw Error('Continuation activation requires expectedTargetApproval from the reviewed preview');
      const nonce = crypto.randomUUID();
      transaction = { ...proposal, nonce, createdAt: new Date().toISOString() };
      atomicJSON(path.join(proposal.directory, `migration-backup-${nonce}.json`), proposal.state);
      atomicJSON(transactionFile, transaction);
    }
    const { state, next, entries, sourceHead, directory, nonce } = transaction;
    if (outcomeMode(next.config) && mapping.expectedTargetApproval !== next.approval) throw Error('Continuation activation requires expectedTargetApproval from the reviewed preview');
    if (git(root, ['rev-parse', 'HEAD']).trim() !== sourceHead || fingerprint(workspaceSnapshot(root)) !== transaction.sourceSnapshot) throw Error('Source changed during migration');
    const current = loadRun(root, id).state;
    if (![state.approval, next.approval].includes(current.approval)) throw Error('Concurrent journal migration');
    if (current.approval === state.approval && fingerprint(current) !== fingerprint(state)) throw Error('Journal changed during migration');
    let head = git(state.worktree, ['rev-parse', 'HEAD']).trim();
    if (head === state.head) {
      if (!transaction.prepared && fingerprint(workspaceSnapshot(state.worktree)) !== transaction.workSnapshot) throw Error('Worktree changed during migration');
      if (transaction.prepared) {
        const actual = workspaceSnapshot(state.worktree), expected = transaction.workFiles;
        for (const name of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
          if (fingerprint(actual[name] || null) === fingerprint(expected[name] || null)) continue;
          const entry = entries.find((e) => e.path === name);
          const replacement = entry && { hash: crypto.createHash('sha256').update(Buffer.from(entry.content, 'base64')).digest('hex'), executable: !!(entry.mode & 0o111) };
          if (!replacement || fingerprint(actual[name]) !== fingerprint(replacement)) throw Error('Concurrent worktree edit during migration');
        }
      }
      // Intent precedes writes. Repeating these exact controller-owned writes reconciles interruption.
      transaction.prepared = true; atomicJSON(transactionFile, transaction);
      for (const entry of entries) {
        const destination = safePath(state.worktree, entry.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, Buffer.from(entry.content, 'base64')); fs.chmodSync(destination, entry.mode);
      }
      if (entries.length) {
        git(state.worktree, ['add', '--', ...entries.map((e) => e.path)]);
        transaction.tree = git(state.worktree, ['write-tree']).trim(); atomicJSON(transactionFile, transaction);
        git(state.worktree, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `Adopt approved v2 milestone controls\n\nQA-Migration: ${nonce}`]);
        head = git(state.worktree, ['rev-parse', 'HEAD']).trim();
      }
    } else if (!transaction.tree || git(state.worktree, ['rev-parse', 'HEAD^']).trim() !== state.head || git(state.worktree, ['rev-parse', 'HEAD^{tree}']).trim() !== transaction.tree || !git(state.worktree, ['show', '-s', '--format=%B']).includes(`QA-Migration: ${nonce}`)) throw Error('Unrecognized concurrent migration commit');
    next.head = head; next.generation = (state.generation || 0) + 1;
    next.events.push({ at: transaction.createdAt, type: 'migrated', from: state.milestone.version || 1, to: 2, continuation: config.continuation || null, oldApproval: state.approval, newApproval: next.approval });
    atomicJSON(path.join(directory, 'state.json'), next);
    fs.renameSync(transactionFile, path.join(directory, `migration-completed-${nonce}.json`));
    return { version: 2, applied: true, head, approval: next.approval, revalidation: next.revalidation };
  } finally { release(); }
}
