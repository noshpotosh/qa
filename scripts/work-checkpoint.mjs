import { git } from "../lib/git.mjs";
import { fingerprint } from "../lib/work-plan.mjs";
import { headSnapshot, workspaceSnapshot, captureArtifacts } from "./work-evidence.mjs";
import { saveRun } from "./work-store.mjs";

export function checkpointAdapterOutputs(state, directory, operation, files) {
  if (git(state.worktree, ["rev-parse", "HEAD"]).trim() !== state.head) throw Error("Workspace head changed before adapter checkpoint");
  const before = headSnapshot(state.worktree), after = workspaceSnapshot(state.worktree);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) =>
    fingerprint(before[name] ?? null) !== fingerprint(after[name] ?? null));
  if (changed.some((file) => !files.includes(file) || !state.config.adapterOutputs.includes(file))) throw Error("Adapter changed undeclared source files");
  if (!changed.length) return;
  captureArtifacts(state.worktree, changed);
  git(state.worktree, ["-c", "core.hooksPath=/dev/null", "add", "--", ...changed]);
  const tree = git(state.worktree, ["write-tree"]).trim();
  if (operation.metadata && operation.metadata.tree !== tree) throw Error("Prepared adapter checkpoint changed");
  operation.metadata ||= { id: `${operation.id}-metadata`, tree };
  saveRun(directory, state, { type: "adapter-checkpoint-prepared", operation: operation.id });
  git(state.worktree, ["-c", "core.hooksPath=/dev/null", "commit", "-m", `Record verified milestone acceptance\n\nQA-Operation: ${operation.metadata.id}`]);
  state.head = git(state.worktree, ["rev-parse", "HEAD"]).trim();
  operation.metadata.commit = state.head;
  saveRun(directory, state, { type: "adapter-checkpoint", operation: operation.id });
}
