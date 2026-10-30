import { fingerprint } from '../lib/work-plan.mjs';
import { workspaceSnapshot } from './work-evidence.mjs';
import { saveRun } from './work-store.mjs';

// Only adapters execute probes. Library scheduling consumes their observed records.
export async function probeCapabilities(executor, context, config) {
  const records = {}, pending = new Set(Object.keys(config.capabilities));
  while (pending.size) {
    let progressed = false;
    for (const id of pending) {
      const command = config.capabilities[id], dependencies = command.requires || [];
      if (dependencies.some((name) => pending.has(name))) continue;
      const missing = dependencies.filter((name) => records[name]?.status !== 'passed');
      let result;
      if (missing.length) result = { status: 'unavailable', output: `Required probes unavailable: ${missing.join(', ')}` };
      else {
        if (context.signal?.aborted || context.now() >= context.deadline) throw Error('Capability probe budget expired or interrupted');
        const before = fingerprint(workspaceSnapshot(context.workspace));
        result = await executor.check(command);
        if (fingerprint(workspaceSnapshot(context.workspace)) !== before) throw Error(`Capability probe changed source: ${id}`);
      }
      records[id] = { id, argv: command.argv, status: result.status, code: result.code ?? null,
        diagnostic: (result.output || '').slice(-8000), observedAt: new Date().toISOString(), readRoots: command.readRoots || [] };
      pending.delete(id); progressed = true;
    }
    if (!progressed) throw Error('Capability dependency cycle');
  }
  return records;
}
export async function refreshCapabilities(executor, context, state, directory) {
  const previous = state.available || [];
  const records = await probeCapabilities(executor, context, state.config);
  const available = Object.keys(records).filter((id) => records[id].status === 'passed');
  const added = available.filter((id) => !previous.includes(id));
  state.probes = records; state.available = available; context.available = available;
  if (added.length && state.milestone.version === 2) state.noProgress = 0;
  saveRun(directory, state, { type: 'capabilities-probed', added, lost: previous.filter((id) => !available.includes(id)) });
  return available;
}
