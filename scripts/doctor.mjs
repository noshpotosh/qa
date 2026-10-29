import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../lib/config.mjs";
import { validateReport } from "../lib/report.mjs";

export function diagnose(root, { remote = false, config = path.join(root, ".qa.json"), gh = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) } = {}) {
  const c = loadConfig(config);
  const result = { configuration: { status: "passed", branch: c.integrationBranch }, workflows: { status: "unavailable" }, credentials: { status: "not-checked", reason: "Use doctor --remote with authenticated gh." }, review: { status: "not-checked", reason: "No live review inferred from configuration." } };
  const caller = path.join(root, ".github/workflows/quality.yml");
  if (fs.existsSync(caller)) {
    const text = fs.readFileSync(caller, "utf8");
    const pins = [...text.matchAll(/(?:quality-(?:review|audit)\.yml@|qa_ref: )([0-9a-f]{40})/g)].map((m) => m[1]);
    result.workflows = { status: pins.length >= 4 && new Set(pins).size === 1 ? "passed" : "unavailable", reason: "Local caller inspection only; remote installation requires --remote." };
  }
  if (!remote) return result;
  const api = (endpoint) => JSON.parse(gh(["api", endpoint]));
  let repo;
  try { repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner; }
  catch { result.credentials = { status: "unavailable", reason: "Authenticated GitHub CLI access required." }; return result; }
  try {
    api(`repos/${repo}/contents/.github/workflows/quality.yml?ref=${encodeURIComponent(c.integrationBranch)}`);
    result.workflows.remote = "installed";
  } catch { result.workflows.remote = "unavailable"; }
  try {
    const names = api(`repos/${repo}/actions/secrets?per_page=100`).secrets.map((s) => s.name);
    const required = [c.agent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"];
    if (c.repair?.enabled) required.push("QA_APP_ID", "QA_APP_PRIVATE_KEY", "OPENAI_API_KEY");
    result.credentials = { status: required.every((n) => names.includes(n)) ? "configured" : "unavailable", missing: required.filter((n) => !names.includes(n)), reason: "Repository secret names only; organization/environment secrets and credential validity are not verified." };
  } catch { result.credentials = { status: "unavailable", reason: "Cannot inspect repository secret names." }; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-doctor-"));
  try {
    const artifact = api(`repos/${repo}/actions/artifacts?name=qa-report-pr&per_page=1`).artifacts.find((a) => !a.expired);
    if (!artifact) throw Error("No retained PR report");
    gh(["run", "download", String(artifact.workflow_run.id), "--name", "qa-report-pr", "--dir", temp]);
    const { agent } = JSON.parse(fs.readFileSync(path.join(temp, "report.json"), "utf8"));
    validateReport(agent);
    result.review = { status: agent.status, runId: artifact.workflow_run.id, head: artifact.workflow_run.head_sha, reason: "Latest retained report; historical evidence does not establish current-head readiness." };
  } catch { result.review = { status: "unavailable", reason: "No readable retained agent review evidence." }; }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
  return result;
}
