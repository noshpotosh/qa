import fs from "node:fs";
import path from "node:path";
import { resolveConfig } from "./config.mjs";
import { safePath, planRuntime } from "./install.mjs";
export const instructions =
  "\n<!-- qa:standards -->\n## Shared QA\n\nFollow the pinned noshpotosh/qa skills for plans, staged changes, PRs and audits. Read `.qa/skills/quality-review/SKILL.md` when installed locally. Machine settings live in `.qa.json`; existing repository policy takes precedence for agent behavior. Report configuration conflicts. Agents review and prepare recommendations; they do not merge or rewrite published history.\n";
export const template = `## Problem
<!-- Describe the problem and why it matters. -->

## Behavior
<!-- Describe the resulting behavior. -->

## Validation
<!-- Record actual commands/results and checks not performed. -->

## Risks
<!-- Describe material risks, or explicitly state none identified. -->

## Visual evidence
<!-- Screenshot/clip URL, or Unavailable: specific explanation. -->

## Size exception
<!-- Required above 800 authored changed lines: explain inseparability or a split plan. -->
`;
export function caller(ref, { agent = "codex", audit = true } = {}) {
  if (!/^[0-9a-f]{40}$/.test(ref))
    throw Error("Initialization requires a full immutable QA commit SHA");
  return `# qa:managed v1
name: Quality
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, edited]
${audit ? '  schedule:\n    - cron: "0 14 * * 1"\n' : ""}  workflow_dispatch:
permissions:
  contents: read
jobs:
  review:
    if: github.event_name == 'pull_request' && !github.event.pull_request.draft
    permissions:
      contents: read
      pull-requests: write
    uses: noshpotosh/qa/.github/workflows/quality-review.yml@${ref}
    with:
      qa_ref: ${ref}
      agent: ${agent}
    secrets:
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
  audit:
    if: github.event_name != 'pull_request'
    permissions:
      contents: read
      issues: write
    uses: noshpotosh/qa/.github/workflows/quality-audit.yml@${ref}
    with:
      qa_ref: ${ref}
      agent: ${agent}
    secrets:
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;
}
export function initialize(
  root,
  { profile = "web", branch = "main", ref, apply = false, runtimeRoot } = {},
) {
  const config = resolveConfig({ profile, integrationBranch: branch });
  const candidates = {
    ".qa.json": JSON.stringify(config, null, 2) + "\n",
    ".github/workflows/quality.yml": caller(ref),
    ".github/pull_request_template.md": template,
    "CLAUDE.md": "@AGENTS.md\n",
  };
  const changes = runtimeRoot ? planRuntime(root, runtimeRoot, ref) : [];
  for (const [name, content] of Object.entries(candidates)) {
    const p = safePath(root, name);
    const previous = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    const previousRef = previous?.match(/qa_ref: ([0-9a-f]{40})/)?.[1];
    const managed = name === ".github/workflows/quality.yml" && previousRef && previous === caller(previousRef);
    changes.push({
      path: name,
      action: previous === null ? "create" : managed && previous !== content ? "update" : "preserve",
      content,
      ...(previous !== null && previous !== content && !managed && name !== "CLAUDE.md"
        ? { conflict: `Existing ${name} preserved; compare the proposed content and reconcile manually.` } : {}),
    });
  }
  if (runtimeRoot) {
    const p = safePath(root, ".gitignore");
    const previous = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    changes.push({ path: ".gitignore", action: previous.split(/\r?\n/).includes("/.qa/") ? "preserve" : previous ? "append" : "create", content: previous + "\n# Local pinned QA runtime\n/.qa/\n" });
  }
  const agents = safePath(root, "AGENTS.md");
  const previous = fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : "";
  changes.push({
    path: "AGENTS.md",
    action: previous.includes("<!-- qa:standards -->")
      ? "preserve"
      : previous
        ? "append"
        : "create",
    content: previous + instructions,
  });
  if (apply)
    for (const c of changes)
      if (c.action !== "preserve") {
        const p = safePath(root, c.path);
        if (c.action === "delete") fs.unlinkSync(p);
        else {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, c.content, { flag: c.action === "create" ? "wx" : "w" });
        }
      }
  return changes;
}
