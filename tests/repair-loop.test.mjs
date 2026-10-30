import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { record, fakeApi, treeSha } from "./fixtures/repair-api.mjs";
import { decideRound, parseReview, hash } from "../lib/repair.mjs";
import { checkRequired, waitForChecks } from "../lib/repair-checks.mjs";
import { finishRound } from "../scripts/repair-round.mjs";

const passed = () => ({ status: "passed", summary: "Requested concern resolved", coverage: [], findings: [] });
const review = () => ({ report: passed(), scope: "within-request", resolvedSources: ["comment:1"] });
function attempt(number = 1) {
  return { number, candidate: { changes: [{ path: "file.txt", content: `fixed ${number}` }] }, validation: { status: "passed", policy: passed() }, review: review(), commit: "e".repeat(40), ci: { status: "passed", head: "e".repeat(40) } };
}
test("completion needs every acceptance signal on the published commit", () => {
  const r = record(); r.currentHead = "e".repeat(40);
  assert.equal(decideRound(r, attempt()).status, "completed");
  for (const mutate of [
    (a) => { a.validation.status = "unavailable"; },
    (a) => { a.validation.policy.status = "failed"; },
    (a) => { a.review = null; },
    (a) => { a.review.report.status = "unavailable"; },
    (a) => { a.review.resolvedSources = []; },
    (a) => { a.ci.head = "f".repeat(40); },
    (a) => { a.ci.status = "unavailable"; },
  ]) {
    const state = record(); state.currentHead = "e".repeat(40);
    const a = attempt(); mutate(a);
    assert.notEqual(decideRound(state, a).status, "completed");
  }
});
test("failed attempts exhaust exactly three rounds and cannot reset the budget", () => {
  const r = record();
  for (let number = 1; number <= 3; number++) {
    const a = attempt(number); a.validation.status = "failed"; delete a.commit;
    decideRound(r, a);
    assert.equal(r.status, number < 3 ? "continue" : "exhausted");
  }
  assert.equal(r.rounds.length, 3);
  assert.throws(() => decideRound(r, attempt(4)), /budget/);
});
test("scope conflicts and repeated unpublished candidates stop immediately", () => {
  for (const scope of ["expanded", "conflicting"]) {
    const r = record(), a = attempt(); a.review.scope = scope;
    assert.equal(decideRound(r, a).status, "blocked");
  }
  const r = record(), a = attempt(); a.validation.status = "failed"; delete a.commit;
  assert.equal(decideRound(r, a).status, "continue");
  const repeated = structuredClone(a); repeated.number = 2;
  assert.equal(decideRound(r, repeated).status, "blocked");
});
test("independent reviews reject invalid reports and unrequested resolution claims", () => {
  assert.equal(parseReview(JSON.stringify(review()), record().sources).report.status, "passed");
  const wrong = review(); wrong.resolvedSources = ["comment:other"];
  assert.throws(() => parseReview(JSON.stringify(wrong), record().sources));
  assert.throws(() => parseReview("not JSON", record().sources));
  const falsePass = review(); falsePass.report.findings = [{ ruleId: "TEST-02", skill: "test-quality", severity: "blocking", location: "a", evidence: "bad", fix: "fix" }];
  assert.throws(() => parseReview(JSON.stringify(falsePass), record().sources));
});
function checksApi(checks, statuses = []) {
  return { rest: { checks: { listForRef: async () => ({ data: checks }), listAnnotations: async () => ({ data: [] }) }, repos: { listCommitStatusesForRef: async () => ({ data: statuses }) } }, paginate: async (fn, args) => (await fn(args)).data };
}
test("required CI rejects skipped, wrong-head, missing and failed checks", async () => {
  const head = "e".repeat(40), args = { owner: "owner", repo: "repo", head, names: ["CI"] };
  const check = { name: "CI", head_sha: head, status: "completed", conclusion: "success" };
  assert.equal((await checkRequired(checksApi([check]), args)).status, "passed");
  assert.equal((await checkRequired(checksApi([{ ...check, conclusion: "skipped" }]), args)).status, "failed");
  assert.equal((await checkRequired(checksApi([{ ...check, head_sha: "f".repeat(40) }]), args)).status, "pending");
  assert.equal((await checkRequired(checksApi([]), args)).status, "pending");
  let clock = 0;
  const result = await waitForChecks(checksApi([]), args, { timeoutMs: 100, now: () => clock, delay: async (ms) => { clock += ms; } });
  assert.equal(result.status, "unavailable");
  assert.equal(clock, 100);
});
test("new pending commit status takes precedence over older success", async () => {
  const api = checksApi([], [{ context: "CI", state: "pending" }, { context: "CI", state: "success" }]);
  assert.equal((await checkRequired(api, { owner: "o", repo: "r", head: "e".repeat(40), names: ["CI"] })).status, "pending");
});
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-loop-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of [".qa-state", ".qa-candidate", ".qa-validation", ".qa-review-result"]) fs.mkdirSync(path.join(dir, name));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  write(".qa-state/record.json", record());
  const candidate = attempt().candidate;
  write(".qa-candidate/candidate.json", candidate);
  write(".qa-validation/validation.json", { status: "passed", policy: passed(), treeSha, candidateHash: hash(candidate) });
  write(".qa-review-result/review.json", review());
  return { dir, write };
}
test("full coordinator publishes only independently accepted candidates and checks exact commit", async (t) => {
  const { dir } = workspace(t), { api, calls } = fakeApi();
  let checked;
  const result = await finishRound(api, { owner: "owner", repo: "repo", round: 1, directory: dir }, { wait: async (_api, args) => { checked = args.head; return { status: "passed", head: args.head }; } });
  assert.equal(result.status, "completed");
  assert.equal(checked, result.currentHead);
  assert.equal(result.rounds.length, 1);
  assert(calls.some((c) => c.name === "updateRef"));
  assert(calls.some((c) => c.name === "createComment"));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, ".qa-state/record.json"), "utf8"));
  assert.equal(saved.status, "completed");
  await assert.rejects(finishRound(api, { owner: "owner", repo: "repo", round: 1, directory: dir }), /budget|mismatch/);
});
test("unavailable or expanded independent review cannot publish", async (t) => {
  for (const outcome of [null, { ...review(), scope: "expanded" }]) {
    const { dir, write } = workspace(t), { api, calls } = fakeApi();
    write(".qa-review-result/review.json", outcome);
    const result = await finishRound(api, { owner: "owner", repo: "repo", round: 1, directory: dir });
    assert(["unavailable", "blocked"].includes(result.status));
    assert(!calls.some((c) => c.name === "updateRef"));
  }
});
test("validation failures feed the next request state without publishing", async (t) => {
  const { dir, write } = workspace(t), { api, calls } = fakeApi();
  write(".qa-validation/validation.json", { status: "failed", output: "Regression assertion failed", policy: passed() });
  const first = await finishRound(api, { owner: "owner", repo: "repo", round: 1, directory: dir });
  assert.equal(first.status, "continue");
  assert.equal(first.rounds[0].validation.output, "Regression assertion failed");
  assert(!calls.some((c) => c.name === "updateRef"));
  const changed = { changes: [{ path: "file.txt", content: "fixed with regression" }] };
  write(".qa-candidate/candidate.json", changed);
  write(".qa-validation/validation.json", { status: "passed", candidateHash: hash(changed), treeSha, policy: passed() });
  const second = await finishRound(api, { owner: "owner", repo: "repo", round: 2, directory: dir }, { wait: async (_api, args) => ({ status: "passed", head: args.head }) });
  assert.equal(second.status, "completed");
  assert.equal(second.rounds.length, 2);
});
