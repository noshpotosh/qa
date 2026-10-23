import { validateReport, unavailable, renderReport } from "./report.mjs";
export const marker = "<!-- noshpotosh-qa:review:v1 -->";
export const auditMarker = "<!-- noshpotosh-qa:audit:v1 -->";
export function parseAgent(text, limit = 100) {
  try {
    const r = validateReport(JSON.parse(text));
    if (r.findings.length > limit) throw Error("Audit exceeds top ten");
    return r;
  } catch {
    return unavailable(
      "Agent output missing or invalid; no clean review is implied.",
    );
  }
}
export function currentSnapshot(snapshot, pr) {
  return (
    pr.state === "open" &&
    snapshot.head === pr.head.sha &&
    snapshot.base === pr.base.sha &&
    snapshot.updatedAt === pr.updated_at
  );
}
export function commentBody(policy, agent, head) {
  const body =
    marker +
    "\n" +
    `Reviewed commit: ${head}\n\n` +
    renderReport(policy, { title: "QA policy" }) +
    "\n" +
    renderReport(agent, { title: "QA agent review", advisory: true });
  return body.length <= 60000
    ? body
    : body.slice(0, 58000) +
        "\n\nReport truncated; download the full QA artifact.\n";
}
export async function publishPR(
  api,
  { owner, repo, number, snapshot, policy, agent },
) {
  const { data: pr } = await api.rest.pulls.get({
    owner,
    repo,
    pull_number: number,
  });
  if (!currentSnapshot(snapshot, pr)) return "stale";
  const comments = await api.paginate(api.rest.issues.listComments, {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
  const existing = comments.find(
    (c) => c.user?.type === "Bot" && c.body?.startsWith(marker),
  );
  // Recheck immediately before writing, including description edits.
  const { data: latest } = await api.rest.pulls.get({
    owner,
    repo,
    pull_number: number,
  });
  if (!currentSnapshot(snapshot, latest)) return "stale";
  const body = commentBody(policy, agent, snapshot.head);
  if (existing)
    await api.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  else
    await api.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body,
    });
  return existing ? "updated" : "created";
}
export async function publishAudit(api, { owner, repo, report, head }) {
  const issues = await api.paginate(api.rest.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const existing = issues.find(
    (i) =>
      !i.pull_request &&
      i.user?.type === "Bot" &&
      i.body?.startsWith(auditMarker),
  );
  const body =
    auditMarker +
    "\n" +
    `Audited commit: ${head}\n\n` +
    renderReport(report, { title: "Weekly quality audit", advisory: true });
  const data = {
    owner,
    repo,
    title: "Weekly quality audit",
    body: body.slice(0, 60000),
  };
  if (existing)
    await api.rest.issues.update({ ...data, issue_number: existing.number });
  else await api.rest.issues.create(data);
  return existing ? "updated" : "created";
}
