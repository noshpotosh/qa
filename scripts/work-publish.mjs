import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { git } from "../lib/git.mjs";
import { loadConfig } from "../lib/config.mjs";
import { acquireLock, storePath, loadRun, saveRun } from "./work-store.mjs";

export function publishMilestone(root, id) {
  const release = acquireLock(storePath(root, id) + ".lock", { recover: true });
  let state, directory;
  const gh = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    ({ state, directory } = loadRun(root, id));
    if (state.pending || !state.checkpoints.length || state.head === state.baseline) throw Error("No reconciled code checkpoints to publish");
    if (git(state.worktree, ["rev-parse", "HEAD"]).trim() !== state.head) throw Error("Owned branch changed since review");
    const config = loadConfig(path.join(root, ".qa.json")), sections = config.sections;
    const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
    execFileSync("git", ["-C", state.worktree, "-c", "core.hooksPath=/dev/null", "push", "origin", `${state.branch}:refs/heads/${state.branch}`], { timeout: 60000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    const remote = JSON.parse(gh(["api", `repos/${repo}/git/ref/heads/${state.branch}`]));
    if (remote.object.sha !== state.head) throw Error("Remote branch changed; publication stopped");
    const existing = JSON.parse(gh(["pr", "list", "--head", state.branch, "--base", config.integrationBranch, "--state", "open", "--json", "number,url"]));
    const body = `## ${sections.Problem}\n${state.milestone.title}\n\n## ${sections.Behavior}\n${state.milestone.scope}\n\n## ${sections.Validation}\nLocal status: ${state.status}. ${state.checkpoints.length} reviewed checkpoints; final regression status: ${state.finalChecks?.results.every((r) => r.status === "passed") ? "passed" : "not completed"}. Local evidence remains in the milestone journal; hosted CI and human acceptance are separate.\n\n## ${sections.Risks}\nHuman review and merge required. Publication does not imply hosted CI or device acceptance.\n\n## ${sections.visual}\nUnavailable: inspect the milestone's declared visual evidence and remaining acceptance gaps.\n\n## ${sections.size}\nWork is split into the recorded task checkpoints. Review or extract those slices separately if the cumulative milestone diff is too large.\n`;
    const file = path.join(directory, "pr-body.md"); fs.writeFileSync(file, body, { mode: 0o600 });
    let url;
    if (existing.length) { gh(["pr", "edit", String(existing[0].number), "--body-file", file]); url = existing[0].url; }
    else url = gh(["pr", "create", "--draft", "--head", state.branch, "--base", config.integrationBranch,
      "--title", state.milestone.title, "--body-file", file]);
    state.publication = { status: "published", head: state.head, url, ci: "not-verified" };
    saveRun(directory, state, { type: "published", url });
    return state.publication;
  } catch (e) {
    if (state) {
      state.publication = { status: "unavailable", reason: e.message };
      saveRun(directory, state, { type: "publication-unavailable" });
    }
    throw e;
  } finally { release(); }
}
