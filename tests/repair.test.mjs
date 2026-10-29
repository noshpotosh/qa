import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/git.mjs";
import { resolveConfig } from "../lib/config.mjs";
import { validateChanges, hash } from "../lib/repair.mjs";
import { collectRequest, publishCandidate, publishProgress } from "../lib/repair-github.mjs";
import { validateWorkspace } from "../scripts/repair-workspace.mjs";
import { commentBody } from "../lib/publish.mjs";

export const sha = "a".repeat(40), base = "b".repeat(40), treeSha = "c".repeat(40);
export const repairConfig = () => resolveConfig({ requireVisualEvidence: false, repair: { enabled: true, validationCommands: ["node --test"], requiredChecks: ["CI"], validationImage: `node@sha256:${"d".repeat(64)}` } });
export function record() {
  return { version: 1, runId: "123", requestId: "owner/repo:123", actor: "owner", target: { kind: "pr", number: 7, branch: "feature", baseBranch: "main", baseSha: base, originalHead: sha }, currentHead: sha, prNumber: 7, metadata: { title: "Fix behavior", body: "Description", updatedAt: "then" }, config: repairConfig(), sources: [{ id: "comment:1", body: "Fix behavior", updatedAt: "then" }], rounds: [], status: "requested", resolvedSources: [] };
}
export function fakeApi() {
  const calls = [];
  const state = {
    userType: "User", permission: "write", head: sha, base, fork: false,
    issue: { number: 7, title: "Fix behavior", body: "Fix the reported behavior", updated_at: "then", state: "open" },
    comments: [{ id: 1, body: "Fix behavior", updated_at: "then", user: { type: "User", login: "human" } }],
    reviewComments: [], config: repairConfig(), tree: [{ path: "file.txt", mode: "100644", type: "blob", sha: treeSha }],
  };
  const fn = (name, body) => async (args) => { calls.push({ name, args }); return { data: typeof body === "function" ? body(args) : body }; };
  const api = { rest: {
    users: { getByUsername: fn("user", () => ({ type: state.userType })) },
    repos: {
      getCollaboratorPermissionLevel: fn("permission", () => ({ permission: state.permission })),
      get: fn("repo", { default_branch: "main" }),
      getContent: fn("config", () => ({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(state.config)).toString("base64") })),
      getCommit: fn("head", () => ({ sha: state.head })),
    },
    pulls: {
      get: fn("pr", () => ({ number: 7, state: "open", title: "Fix behavior", body: "Description", updated_at: "then", head: { sha: state.head, ref: "feature", repo: { full_name: state.fork ? "fork/repo" : "owner/repo" } }, base: { sha: state.base, ref: "main" } })),
      listReviewComments: fn("reviewComments", () => state.reviewComments),
      create: fn("createPR", { number: 8 }),
    },
    issues: {
      get: fn("issue", () => state.issue),
      listComments: fn("comments", () => state.comments),
      updateComment: fn("updateComment", {}), createComment: fn("createComment", {}),
    },
    git: {
      getTree: fn("tree", () => ({ tree: state.tree, truncated: false })),
      getCommit: fn("gitCommit", { tree: { sha: treeSha } }),
      createBlob: fn("blob", { sha: treeSha }),
      createTree: fn("createTree", { sha: treeSha }),
      createCommit: fn("commit", { sha: "e".repeat(40) }),
      updateRef: fn("updateRef", {}), createRef: fn("createRef", {}),
    },
  }, paginate: async (method, args) => (await method(args)).data };
  return { api, state, calls };
}
const request = { owner: "owner", repo: "repo", actor: "owner", eventName: "workflow_dispatch", ref: "refs/heads/main", runId: "123", runAttempt: "1", kind: "pr", number: 7, sources: "comment:1" };
test("only human write-authorized first-attempt default-branch dispatches can request repairs", async () => {
  const { api, state } = fakeApi();
  const r = await collectRequest(api, request);
  assert.equal(r.sources[0].body, "Fix behavior");
  for (const change of [{ eventName: "issue_comment" }, { runAttempt: "2" }, { ref: "refs/heads/feature" }]) await assert.rejects(collectRequest(api, { ...request, ...change }));
  state.permission = "read";
  await assert.rejects(collectRequest(api, request), /write permission/);
  state.permission = "write"; state.userType = "Bot";
  await assert.rejects(collectRequest(api, request), /human/);
});
test("collection rejects forks, stale QA reports and foreign or stale comments", async () => {
  const { api, state } = fakeApi();
  state.fork = true;
  await assert.rejects(collectRequest(api, request), /same-repository/);
  state.fork = false;
  await assert.rejects(collectRequest(api, { ...request, sources: "comment:99" }), /does not belong/);
  state.reviewComments = [{ id: 9, user: { type: "User" }, body: "Fix it", commit_id: base }];
  await assert.rejects(collectRequest(api, { ...request, sources: "review:9" }), /stale/);
  const passed = { status: "passed", summary: "No findings", coverage: [], findings: [] };
  const failed = { status: "failed", summary: "Defect", coverage: [], findings: [{ ruleId: "TEST-02", skill: "test-quality", severity: "blocking", location: "file.txt:1", evidence: "Wrong behavior", fix: "Use correct behavior" }] };
  state.comments = [{ id: 2, user: { login: "github-actions[bot]", type: "Bot" }, body: commentBody(passed, failed, sha, base), updated_at: "then" }];
  assert.equal((await collectRequest(api, { ...request, sources: "qa:2:0" })).sources[0].finding.ruleId, "TEST-02");
  state.head = "f".repeat(40);
  await assert.rejects(collectRequest(api, { ...request, sources: "qa:2:0" }), /stale/);
});
test("issue scope is captured from its body with a separate repair branch", async () => {
  const { api } = fakeApi();
  const result = await collectRequest(api, { ...request, kind: "issue", sources: "" });
  assert.equal(result.prNumber, null);
  assert.equal(result.target.branch, "codex/repair-issue-7-123");
  assert.equal(result.sources[0].body, "Fix the reported behavior");
});
test("replacement validation rejects control files, traversal, symlinks, submodules and collisions", () => {
  const tree = [{ path: "link", type: "blob", mode: "120000" }, { path: "module", type: "commit", mode: "160000" }];
  for (const name of ["../escape", "/absolute", ".git/config", ".github/workflows/ci.yml", ".qa.json", "nested/AGENTS.md", "link/child", "module/child", "a\\b", "a/./b"]) assert.throws(() => validateChanges({ changes: [{ path: name, content: "x" }] }, tree));
  assert.throws(() => validateChanges({ changes: [{ path: "a", content: "x" }, { path: "A", content: "y" }] }, []));
  assert.throws(() => validateChanges({ changes: [{ path: "a", content: "x\0y" }] }, []));
  assert.doesNotThrow(() => validateChanges({ changes: [{ path: "src/new.mjs", content: "export const fixed = true;" }] }, []));
});
test("publisher binds validation to candidate and tree and refuses concurrent changes", async () => {
  const { api, state, calls } = fakeApi();
  const candidate = { changes: [{ path: "file.txt", content: "fixed" }] };
  const validation = { status: "passed", policy: { status: "passed" }, candidateHash: hash(candidate), treeSha };
  await assert.rejects(publishCandidate(api, { owner: "owner", repo: "repo", record: record(), candidate, validation: { ...validation, candidateHash: "wrong" } }), /bound/);
  state.head = "f".repeat(40);
  await assert.rejects(publishCandidate(api, { owner: "owner", repo: "repo", record: record(), candidate, validation }), /Concurrent/);
  assert(!calls.some((c) => c.name === "updateRef"));
  state.head = sha;
  const r = record();
  await publishCandidate(api, { owner: "owner", repo: "repo", record: r, candidate, validation });
  assert.equal(calls.find((c) => c.name === "updateRef").args.force, false);
  assert.equal(r.currentHead, "e".repeat(40));
  r.rounds = [{}, {}, {}];
  await assert.rejects(publishCandidate(api, { owner: "owner", repo: "repo", record: r, candidate, validation }), /budget/);
});
test("progress updates one bot-owned comment for the request", async () => {
  const { api, state, calls } = fakeApi(), r = record();
  await publishProgress(api, { owner: "owner", repo: "repo", record: r });
  const body = calls.find((c) => c.name === "createComment").args.body;
  state.comments = [{ id: 3, body, user: { type: "User" } }, { id: 4, body, user: { type: "Bot" } }];
  await publishProgress(api, { owner: "owner", repo: "repo", record: r });
  assert.equal(calls.find((c) => c.name === "updateComment").args.comment_id, 4);
});
test("real candidate path creates a policy-checked tree and isolates test commands", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-repair-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init"]);
  git(root, ["config", "user.name", "QA Test"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  fs.writeFileSync(path.join(root, "file.txt"), "broken");
  git(root, ["add", "."]); git(root, ["commit", "-m", "Initial"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim(), r = record();
  r.currentHead = head; r.target.baseSha = head; r.target.kind = "issue";
  let invoked = false;
  const result = validateWorkspace(r, { changes: [{ path: "file.txt", content: "fixed" }] }, root, { run: (command, args, options) => {
    invoked = true;
    assert.equal(command, "docker");
    assert(args.includes("--cap-drop=ALL"));
    assert.equal(args.filter((a) => a === "--mount").length, 1);
    assert(!Object.keys(options.env).some((key) => /TOKEN|KEY|GITHUB/.test(key)));
    assert.equal(fs.readFileSync(path.join(root, "file.txt"), "utf8"), "fixed");
  } });
  assert(invoked);
  assert.equal(result.status, "passed");
  assert.equal(result.policy.status, "passed");
  assert.match(result.treeSha, /^[0-9a-f]{40}$/);
});
