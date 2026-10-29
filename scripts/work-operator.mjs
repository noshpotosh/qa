import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { git } from "../lib/git.mjs";
import { fingerprint, approvalIdentity } from "../lib/work-plan.mjs";
import { fileHash } from "./work-evidence.mjs";
import { loadRun, storePath, acquireLock, saveRun } from "./work-store.mjs";
import { readMilestone, invokeAdapter } from "./work-source.mjs";
import { checkpointAdapterOutputs } from "./work-checkpoint.mjs";
import { effectiveMilestone } from "../lib/work-state.mjs";

export function acceptCriterion(root, config, id, criterionId, evidenceFile) {
  const release = acquireLock(storePath(root, id) + ".lock", { recover: true });
  try {
    const { state, directory } = loadRun(root, id);
    const snapshot = readMilestone(root, config, id);
    if (state.pending || state.operatorPending) throw Error("Resume the pending recorded operation before submitting another attestation");
    if (state.approval !== approvalIdentity(snapshot.milestone, config)) throw Error("Acceptance scope changed");
    const criterion = snapshot.milestone.criteria.find((c) => c.id === criterionId);
    if (!criterion || criterion.kind !== "human") throw Error("Operator acceptance requires an existing human criterion");
    if (effectiveMilestone(state, snapshot).criteria.some((c) => c.kind === "automated" && !c.done)) throw Error("Finish automated criteria before the consolidated human handoff");
    if (state.finalChecks?.codeHead !== state.codeHead || state.finalChecks.generation !== (state.generation || 0) || !state.finalChecks.results.every((result) => result.status === "passed")) throw Error("Resume final validation before recording human acceptance");
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    if (evidence.version !== 1 || evidence.criterionId !== criterionId || evidence.sourceHead !== state.head ||
        typeof evidence.buildId !== "string" || !evidence.buildId.trim() || typeof evidence.observation !== "string" || !evidence.observation.trim()) throw Error("Human evidence must identify the criterion, matching sourceHead, buildId and observation");
    if (git(state.worktree, ["rev-parse", "HEAD"]).trim() !== state.head || git(state.worktree, ["status", "--porcelain"]).trim()) throw Error("Human acceptance requires the exact clean candidate build source");
    const receipt = { kind: "human-attested", operator: os.userInfo().username, evidence: fileHash(evidenceFile), sourceHead: state.head, codeIdentity: state.codeHead || state.head, generation: state.generation || 0,
      buildId: evidence.buildId, observation: evidence.observation };
    const operation = { id: fingerprint(receipt), changed: [], receipt, criterionId };
    state.operatorPending = operation;
    saveRun(directory, state, { type: "attestation-prepared", criterion: criterionId });
    finishAttestation(root, config, state, directory);
    saveRun(directory, state, { type: "human-attested", criterion: criterionId });
    return receipt;
  } finally { release(); }
}
export function finishAttestation(root, config, state, directory) {
  const operation = state.operatorPending;
  if (!operation) return;
  if (config.adapter) {
    const result = invokeAdapter(root, config, { operation: "attest", milestoneId: state.id,
      expectedRevision: state.sourceRevision, criterionId: operation.criterionId,
      receipt: operation.receipt, operationId: operation.id, workspace: state.worktree });
    if (result.version !== 1 || typeof result.revision !== "string") throw Error("Invalid attestation adapter response");
    if ((result.checkpointFiles || []).some((file) => !config.adapterOutputs.includes(file))) throw Error("Unapproved adapter output");
    checkpointAdapterOutputs(state, directory, operation, result.checkpointFiles || []);
    state.sourceRevision = result.revision;
  }
  state.accepted[operation.criterionId] = operation.receipt;
  state.operatorPending = null;
  saveRun(directory, state, { type: "human-attestation-reconciled", criterion: operation.criterionId });
}
