#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig, skills } from "../lib/config.mjs";
import { diffContext, git } from "../lib/git.mjs";
import { checkPolicy } from "../lib/policy.mjs";
import { renderReport } from "../lib/report.mjs";
import { initialize } from "../lib/init.mjs";
try {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      staged: { type: "boolean" },
      base: { type: "string" },
      head: { type: "string" },
      config: { type: "string" },
      pr: { type: "string" },
      json: { type: "boolean" },
      profile: { type: "string" },
      branch: { type: "string" },
      ref: { type: "string" },
      apply: { type: "boolean" },
    },
  });
  const command = positionals[0],
    root = process.cwd();
  if (command === "init") {
    const changes = initialize(root, {
      profile: v.profile,
      branch: v.branch,
      ref: v.ref,
      apply: v.apply,
    });
    console.log(JSON.stringify({ applied: !!v.apply, changes }, null, 2));
  } else if (command === "check") {
    const c = loadConfig(v.config || ".qa.json");
    const ctx = diffContext(root, v);
    const result = checkPolicy(
      ctx,
      c,
      v.pr ? JSON.parse(fs.readFileSync(v.pr, "utf8")) : undefined,
    );
    console.log(
      v.json
        ? JSON.stringify({ ...result, context: ctx }, null, 2)
        : renderReport(result.report),
    );
    if (result.report.status === "failed") process.exitCode = 1;
  } else if (command === "doctor") {
    const c = loadConfig(v.config || ".qa.json");
    git(root, ["--version"]);
    const skillRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../skills",
    );
    for (const s of skills)
      if (!fs.existsSync(path.join(skillRoot, s, "SKILL.md")))
        throw Error(`Missing skill: ${s}`);
    console.log(
      `Configuration and ${skills.length} standards valid. Node ${process.version}; integration branch ${c.integrationBranch}.`,
    );
    console.log("Validation commands (not executed):", c.validationCommands);
    console.log(
      "API credentials, live checks and repository protection require separate verification.",
    );
  } else
    throw Error(
      "Usage: qa init --profile NAME --ref SHA [--apply] | qa check (--staged | --base REF [--head REF]) [--pr JSON] [--json] | qa doctor",
    );
} catch (error) {
  console.error(`QA unavailable: ${error.message}`);
  process.exitCode = 2;
}
