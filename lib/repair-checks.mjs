export async function checkRequired(api, { owner, repo, head, names }) {
  const checks = await api.paginate(api.rest.checks.listForRef, { owner, repo, ref: head, filter: "latest", per_page: 100 });
  const statuses = await api.paginate(api.rest.repos.listCommitStatusesForRef, { owner, repo, ref: head, per_page: 100 });
  const latest = new Map();
  for (const s of statuses) if (!latest.has(s.context)) latest.set(s.context, s);
  const evidence = names.map((name) => {
    const matching = checks.filter((c) => c.name === name);
    const status = latest.get(name);
    const records = [...matching.map((c) => ({ head: c.head_sha, status: c.status === "completed" ? c.conclusion === "success" ? "passed" : "failed" : "pending", url: c.details_url, summary: c.output?.summary?.slice(-12000), text: c.output?.text?.slice(-12000), checkRunId: c.id })), ...(status ? [{ head, status: status.state === "success" ? "passed" : ["error", "failure"].includes(status.state) ? "failed" : "pending", url: status.target_url, summary: status.description }] : [])];
    return { name, status: !records.length ? "missing" : records.some((r) => r.head !== head) ? "unavailable" : records.some((r) => r.status === "failed") ? "failed" : records.every((r) => r.status === "passed") ? "passed" : "pending", records };
  });
  return { head, status: evidence.some((c) => c.status === "failed") ? "failed" : evidence.length && evidence.every((c) => c.status === "passed") ? "passed" : "pending", checks: evidence };
}
export async function waitForChecks(api, args, { now = Date.now, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 15 * 60 * 1000 } = {}) {
  const deadline = now() + timeoutMs;
  let result;
  do {
    result = await checkRequired(api, args);
    if (result.status !== "pending") {
      if (result.status === "failed") {
        for (const check of result.checks.filter((c) => c.status === "failed")) {
          for (const item of check.records.filter((r) => r.status === "failed" && r.checkRunId)) {
            try {
              const annotations = await api.paginate(api.rest.checks.listAnnotations, { owner: args.owner, repo: args.repo, check_run_id: item.checkRunId, per_page: 100 });
              item.annotations = annotations.slice(0, 20).map((a) => ({ path: a.path, line: a.start_line, message: a.message?.slice(-4000) }));
            } catch { item.annotationCoverage = "Annotations unavailable"; }
          }
        }
      }
      return result;
    }
    if (now() >= deadline) break;
    await delay(Math.min(15000, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  return { ...result, status: "unavailable", reason: "Required CI missing, pending or unavailable at timeout." };
}
