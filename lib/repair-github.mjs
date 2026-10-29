import { resolveConfig } from "./config.mjs";
import { marker } from "./publish.mjs";
import { validateReport } from "./report.mjs";
import { hash, validateChanges, validateRecord, repairMarker, repairBody } from "./repair.mjs";

const jsonFile = async (api, args) => {
  const { data } = await api.rest.repos.getContent(args);
  if (data.type !== "file" || data.encoding !== "base64") throw Error("Expected configuration file");
  return JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
};
export async function collectRequest(api, { owner, repo, actor, eventName, ref, runId, runAttempt, kind, number, sources = "" }) {
  if (eventName !== "workflow_dispatch" || String(runAttempt) !== "1" || !/^[0-9]+$/.test(String(runId)) || !["issue", "pr"].includes(kind) || !Number.isSafeInteger(number) || number < 1 || /\[bot\]$/i.test(actor)) throw Error("Invalid or repeated manual repair request");
  const { data: user } = await api.rest.users.getByUsername({ username: actor });
  if (user.type !== "User") throw Error("Repairs require a human requester");
  const { data: permission } = await api.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: actor });
  if (!["admin", "maintain", "write"].includes(permission.permission)) throw Error("Repair requester needs repository write permission");
  const { data: repository } = await api.rest.repos.get({ owner, repo });
  if (ref !== `refs/heads/${repository.default_branch}`) throw Error("Dispatch repairs from the default branch");
  let pr, issue, config, head, base, branch;
  if (kind === "pr") {
    ({ data: pr } = await api.rest.pulls.get({ owner, repo, pull_number: number }));
    if (pr.state !== "open" || pr.head.repo?.full_name !== `${owner}/${repo}`) throw Error("Only open same-repository PRs can be repaired");
    config = resolveConfig(await jsonFile(api, { owner, repo, path: ".qa.json", ref: pr.base.sha }));
    if (pr.base.ref !== config.integrationBranch || pr.head.ref === config.integrationBranch) throw Error("PR does not target the configured integration branch");
    head = pr.head.sha; base = pr.base.sha; branch = pr.head.ref;
  } else {
    ({ data: issue } = await api.rest.issues.get({ owner, repo, issue_number: number }));
    if (issue.pull_request || issue.state !== "open" || !issue.body?.trim()) throw Error("Expected an open issue with a repair description");
    const initial = resolveConfig(await jsonFile(api, { owner, repo, path: ".qa.json", ref: repository.default_branch }));
    ({ data: { sha: base } } = await api.rest.repos.getCommit({ owner, repo, ref: initial.integrationBranch }));
    config = resolveConfig(await jsonFile(api, { owner, repo, path: ".qa.json", ref: base }));
    if (config.integrationBranch !== initial.integrationBranch) throw Error("Conflicting integration branch configuration");
    head = base; branch = `codex/repair-issue-${number}-${runId}`;
  }
  if (!config.repair.enabled) throw Error("Repair is not enabled in trusted base configuration");
  const selected = [];
  if (kind === "issue") {
    if (sources.trim()) throw Error("Issue scope is its current body; do not supply comment selectors");
    selected.push({ id: `issue:${number}`, body: issue.body, title: issue.title, updatedAt: issue.updated_at });
  } else {
    const ids = sources.split(/[\s,]+/).filter(Boolean);
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length) throw Error("Select 1–20 distinct QA findings or human comments");
    const comments = await api.paginate(api.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 });
    const reviews = await api.paginate(api.rest.pulls.listReviewComments, { owner, repo, pull_number: number, per_page: 100 });
    for (const id of ids) {
      const match = /^(qa|comment|review):([1-9][0-9]*)(?::([0-9]+))?$/.exec(id);
      if (!match || (match[1] === "qa") !== (match[3] !== undefined)) throw Error(`Invalid source selector: ${id}`);
      const item = (match[1] === "review" ? reviews : comments).find((c) => String(c.id) === match[2]);
      if (!item) throw Error(`Selected comment does not belong to PR: ${id}`);
      if (match[1] === "qa") {
        if (item.user?.login !== "github-actions[bot]" || !item.body?.startsWith(marker)) throw Error("Expected trusted QA bot report");
        const encoded = item.body.match(/<!-- qa:report:v1 ([A-Za-z0-9+/=]+) -->/)?.[1];
        if (!encoded) throw Error("QA report predates structured repair selectors; rerun QA review");
        const report = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (report.head !== head || report.base !== base) throw Error("Selected QA report is stale");
        validateReport(report.policy); validateReport(report.agent);
        const finding = [...report.policy.findings, ...report.agent.findings][Number(match[3])];
        if (!finding) throw Error("Unknown QA finding index");
        selected.push({ id, finding, updatedAt: item.updated_at });
      } else {
        if (item.user?.type !== "User" || !item.body?.trim()) throw Error("Select a human review comment");
        if (match[1] === "review" && item.commit_id !== head) throw Error("Selected inline review comment is stale");
        selected.push({ id, body: item.body, path: item.path || null, updatedAt: item.updated_at });
      }
    }
  }
  return validateRecord({ version: 1, runId: String(runId), requestId: `${owner}/${repo}:${runId}`, actor, target: { kind, number, branch, baseBranch: config.integrationBranch, baseSha: base, originalHead: head }, currentHead: head, prNumber: pr?.number || null, metadata: pr ? { title: pr.title, body: pr.body || "", updatedAt: pr.updated_at } : { title: issue.title, body: issue.body, updatedAt: issue.updated_at }, config, sources: selected, rounds: [], status: "requested", resolvedSources: [] });
}
export async function sourceTree(api, { owner, repo, sha }) {
  const { data } = await api.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: "1" });
  if (data.truncated) throw Error("Source tree truncated; manual repair required");
  return data.tree;
}
export async function assertCurrent(api, { owner, repo, record }) {
  const { data: permission } = await api.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: record.actor });
  if (!["write", "maintain", "admin"].includes(permission.permission)) throw Error("Requester no longer has repository write permission");
  const { data: commit } = await api.rest.repos.getCommit({ owner, repo, ref: record.prNumber ? record.target.branch : record.target.baseBranch });
  if (commit.sha !== record.currentHead) throw Error("Concurrent branch change; start a new request after reviewing it");
  if (record.prNumber) {
    const { data: pr } = await api.rest.pulls.get({ owner, repo, pull_number: record.prNumber });
    if (pr.state !== "open" || pr.head.repo?.full_name !== `${owner}/${repo}` || pr.head.ref !== record.target.branch || pr.head.sha !== record.currentHead || pr.base.sha !== record.target.baseSha || pr.base.ref !== record.target.baseBranch) throw Error("PR scope changed during repair");
    if (record.target.kind === "pr" && (pr.title !== record.metadata.title || (pr.body || "") !== record.metadata.body)) throw Error("PR description changed during repair");
  }
  if (record.target.kind === "issue") {
    const { data: issue } = await api.rest.issues.get({ owner, repo, issue_number: record.target.number });
    if (issue.state !== "open" || issue.body !== record.metadata.body || issue.title !== record.metadata.title) throw Error("Issue scope changed during repair");
  }
  for (const source of record.sources.filter((s) => /^(?:comment|review):/.test(s.id))) {
    const [kind, id] = source.id.split(":");
    const { data: item } = kind === "review"
      ? await api.rest.pulls.getReviewComment({ owner, repo, comment_id: Number(id) })
      : await api.rest.issues.getComment({ owner, repo, comment_id: Number(id) });
    if (item.updated_at !== source.updatedAt || item.body !== source.body) throw Error("Selected human feedback changed during repair");
  }
}
export function issuePRBody(record) {
  const s = record.config.sections;
  return `## ${s.Problem}\nRepair requested for #${record.target.number}.\n\n## ${s.Behavior}\nAddresses the explicitly requested issue; see repair progress and artifacts.\n\n## ${s.Validation}\nRecorded in QA repair workflow artifacts; readiness requires passing checks and independent review.\n\n## ${s.Risks}\nAgent-generated changes require human review and merge.\n\n## ${s.visual}\nUnavailable: automated repair has no visual evidence capture.\n`;
}
export async function publishCandidate(api, { owner, repo, record, candidate, validation }) {
  validateRecord(record);
  if (record.rounds.length >= 3) throw Error("Repair round budget exhausted");
  if (validation.status !== "passed" || validation.policy?.status !== "passed" || validation.candidateHash !== hash(candidate)) throw Error("Candidate lacks passing validation bound to its contents");
  const tree = await sourceTree(api, { owner, repo, sha: record.currentHead });
  validateChanges(candidate, tree);
  if (!candidate.changes.length) throw Error("No changes proposed");
  const entries = [];
  for (const change of candidate.changes) {
    if (change.content === null) entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
    else {
      const { data: blob } = await api.rest.git.createBlob({ owner, repo, content: change.content, encoding: "utf-8" });
      entries.push({ path: change.path, mode: tree.find((e) => e.path === change.path)?.mode || "100644", type: "blob", sha: blob.sha });
    }
  }
  const { data: parent } = await api.rest.git.getCommit({ owner, repo, commit_sha: record.currentHead });
  const { data: newTree } = await api.rest.git.createTree({ owner, repo, base_tree: parent.tree.sha, tree: entries });
  if (newTree.sha !== validation.treeSha) throw Error("Published tree would differ from validated tree");
  await assertCurrent(api, { owner, repo, record });
  const { data: commit } = await api.rest.git.createCommit({ owner, repo, message: `fix(qa): address repair request ${record.target.number}, round ${record.rounds.length + 1}`, tree: newTree.sha, parents: [record.currentHead] });
  if (!record.prNumber) {
    await api.rest.git.createRef({ owner, repo, ref: `refs/heads/${record.target.branch}`, sha: commit.sha });
    const { data: pr } = await api.rest.pulls.create({ owner, repo, head: record.target.branch, base: record.target.baseBranch, draft: true, title: `fix: repair issue #${record.target.number}`, body: issuePRBody(record) });
    record.prNumber = pr.number;
  } else {
    // GitHub rejects non-fast-forward movement if a human pushes after the recheck.
    await api.rest.git.updateRef({ owner, repo, ref: `heads/${record.target.branch}`, sha: commit.sha, force: false });
  }
  record.currentHead = commit.sha;
  return commit.sha;
}
export async function publishProgress(api, { owner, repo, record }) {
  const issue_number = record.target.number;
  const comments = await api.paginate(api.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
  const prefix = `${repairMarker}\nRequest: ${record.runId}\n`;
  const existing = comments.find((c) => c.user?.type === "Bot" && c.body?.startsWith(prefix));
  const body = repairBody(record);
  if (existing) await api.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  else await api.rest.issues.createComment({ owner, repo, issue_number, body });
}
