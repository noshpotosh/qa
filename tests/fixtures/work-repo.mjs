import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../../lib/git.mjs";
import { resolveWork } from "../../lib/work-config.mjs";

export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-work-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "QA Test"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src/app.mjs"), "broken\n");
  const milestone = { id: "demo", title: "Demo", scope: "Fix demo behavior", allowedPaths: ["src/**", "evidence/**"], finalChecks: ["test"],
    criteria: [{ id: "correct", description: "Correct demo", kind: "automated", done: false, evidence: [], checks: ["test"] }],
    tasks: [{ id: "fix", title: "Fix demo", kind: "implementation", criteria: ["correct"], checks: ["test"], dependencies: [], capabilities: [], priority: 1 }] };
  fs.writeFileSync(path.join(root, ".qa-work.json"), JSON.stringify({ version: 1, milestones: [milestone] }));
  git(root, ["add", "."]); git(root, ["commit", "-m", "Clean baseline"]);
  const config = resolveWork({ enabled: true, checks: { test: { argv: ["node", "--test"], timeoutSeconds: 30 } } });
  return { root, config, snapshot: { revision: "initial", milestone } };
}
