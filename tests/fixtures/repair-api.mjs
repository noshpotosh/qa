import { resolveConfig } from "../../lib/config.mjs";

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
      getReviewComment: fn("reviewComment", (args) => state.reviewComments.find((c) => c.id === args.comment_id)),
      create: fn("createPR", { number: 8 }),
    },
    issues: {
      get: fn("issue", () => state.issue),
      listComments: fn("comments", () => state.comments),
      getComment: fn("comment", (args) => state.comments.find((c) => c.id === args.comment_id)),
      updateComment: fn("updateComment", {}), createComment: fn("createComment", {}),
    },
    git: {
      getTree: fn("tree", () => ({ tree: state.tree, truncated: false })),
      getCommit: fn("gitCommit", { tree: { sha: treeSha } }),
      createBlob: fn("blob", { sha: treeSha }),
      createTree: fn("createTree", { sha: treeSha }),
      createCommit: fn("commit", { sha: "e".repeat(40) }),
      updateRef: fn("updateRef", (args) => { state.head = args.sha; return {}; }), createRef: fn("createRef", {}),
    },
  }, paginate: async (method, args) => (await method(args)).data };
  return { api, state, calls };
}
