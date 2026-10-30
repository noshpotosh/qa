import fs from "node:fs";
import path from "node:path";
import { decideRound, parseReview, validateRecord } from "../lib/repair.mjs";
import { assertCurrent, publishCandidate, publishProgress } from "../lib/repair-github.mjs";
import { waitForChecks } from "../lib/repair-checks.mjs";

export async function finishRound(api, { owner, repo, round, directory }, { wait = waitForChecks } = {}) {
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")); } catch { return null; } };
  const record = validateRecord(read(".qa-state/record.json"));
  if (round !== record.rounds.length + 1 || round > 3 || !["requested", "continue"].includes(record.status)) throw Error("Round budget or state mismatch");
  const attempt = { number: round, candidate: read(".qa-candidate/candidate.json"), validation: read(".qa-validation/validation.json") || { status: "unavailable", reason: "Validation job did not produce evidence." } };
  if (attempt.validation.status === "passed") {
    try { attempt.review = parseReview(fs.readFileSync(path.join(directory, ".qa-review-result/review.json"), "utf8"), record.sources); }
    catch { /* Missing or malformed independent review is unavailable. */ }
  }
  try {
    await assertCurrent(api, { owner, repo, record });
    if (attempt.review?.report.status === "passed" && attempt.review.scope === "within-request" && record.sources.every((s) => attempt.review.resolvedSources.includes(s.id))) {
      attempt.commit = await publishCandidate(api, { owner, repo, record, candidate: attempt.candidate, validation: attempt.validation });
      attempt.ci = await wait(api, { owner, repo, head: attempt.commit, names: record.config.repair.requiredChecks });
      await assertCurrent(api, { owner, repo, record });
    }
  } catch (e) { attempt.error = e.message; }
  decideRound(record, attempt);
  fs.writeFileSync(path.join(directory, ".qa-state/record.json"), JSON.stringify(record, null, 2));
  await publishProgress(api, { owner, repo, record });
  return record;
}
