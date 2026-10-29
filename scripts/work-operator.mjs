import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { git } from "../lib/git.mjs";
import { fingerprint, approvalIdentity } from "../lib/work-plan.mjs";
import { fileHash } from "./work-evidence.mjs";
import { loadRun, storePath, acquireLock, saveRun } from "./work-store.mjs";
import { readMilestone, invokeAdapter } from "./work-source.mjs";

export function acceptCriterion(root, config, id, criterionId, evidenceFile) {
  const release = acquireLock(storePath(root, id) + ".lock", { recover: true });
  try {
    const { state, directory } = loadRun(root, id);
    const snapshot = readMilestone(root, config, id);
    if (state.approval !== approvalIdentity(snapshot.milestone, config)) throw Error("Acceptance scope changed");
    const criterion = snapshot.milestone.criteria.find((c) => c.id === criterionId);
    if (!criterion || criterion.kind !== "human") throw Error("Operator acceptance requires an existing human criterion");
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    if (evidence.version !== 1 || evidence.criterionId !== criterionId || evidence.sourceHead !== state.head ||
        typeof evidence.buildId !== "string" || !evidence.buildId.trim() || typeof evidence.observation !== "string" || !evidence.observation.trim()) throw Error("Human evidence must identify the criterion, matching sourceHead, buildId and observation");
    if (git(state.worktree, ["rev-parse", "HEAD"]).trim() !== state.head || git(state.worktree, ["status", "--porcelain"]).trim()) throw Error("Human acceptance requires the exact clean candidate build source");
    const receipt = { kind: "human-attested", operator: os.userInfo().username, evidence: fileHash(evidenceFile), sourceHead: state.head,
      buildId: evidence.buildId, observation: evidence.observation };
    if (config.adapter) {
      const result = invokeAdapter(root, config, { operation: "attest", milestoneId: id,
        expectedRevision: snapshot.revision, criterionId, receipt, operationId: fingerprint(receipt) });
      if (result.version !== 1 || typeof result.revision !== "string") throw Error("Invalid attestation adapter response");
      state.sourceRevision = result.revision;
    }
    state.accepted[criterionId] = receipt;
    saveRun(directory, state, { type: "human-attested", criterion: criterionId });
    return receipt;
  } finally { release(); }
}
