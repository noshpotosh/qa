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
import { inspectRepository, sourceRef } from "../lib/install.mjs";
import { diagnose } from "../scripts/doctor.mjs";
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
      remote: { type: "boolean" },
      repairs: { type: "boolean" },
    },
  });
  const command = positionals[0],
    root = process.cwd();
  if (command === "init") {
    const detected = inspectRepository(root);
    const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const ref = sourceRef(runtimeRoot);
    if (v.ref && v.ref !== ref) throw Error("--ref must match the running release's source SHA");
    if (!(v.profile || detected.profile)) throw Error("Profile is ambiguous; choose --profile web|static-site|realtime-game|research|assets|hardware|qa-tooling");
    if (!(v.branch || detected.branch)) throw Error("Integration branch is ambiguous; specify --branch NAME");
    const changes = initialize(detected.root, {
      profile: v.profile || detected.profile,
      branch: v.branch || detected.branch,
      ref,
      apply: v.apply,
      runtimeRoot,
      repairs: v.repairs,
    });
    const summary = { applied: !!v.apply, detected, sourceSha: ref, changes: changes.map(({ content, ...c }) => c) };
    if (v.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`${v.apply ? "Applied" : "Preview"}: ${detected.root}; ${v.profile || detected.profile}; target ${v.branch || detected.branch}; QA ${ref}`);
      for (const c of summary.changes.filter((c) => !c.path.startsWith(".qa/"))) console.log(`${c.action.padEnd(8)} ${c.path}${c.conflict ? ` — ${c.conflict}` : ""}`);
      console.log(`${changes.filter((c) => c.path.startsWith(".qa/") && c.action !== "preserve").length} local runtime changes. Existing workflows: ${detected.workflows.join(", ") || "none"}.`);
      if (!v.apply) console.log("Confirm these settings by repeating with --apply. Use --json for a machine-readable summary.");
      if (v.repairs) console.log("Repair workflow proposed. Enable repair in trusted .qa.json with explicit validation commands, required checks and a digest-pinned container; configure owner-managed OPENAI_API_KEY, QA_APP_ID and QA_APP_PRIVATE_KEY. See docs/repairs.md in the source repository.");
      for (const c of changes.filter((c) => c.conflict)) console.log(`\nProposed ${c.path}:\n${c.content}`);
    }
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
    console.log(JSON.stringify(diagnose(inspectRepository(root).root, { remote: v.remote, config: path.resolve(v.config || ".qa.json") }), null, 2));
  } else
    throw Error(
      "Usage: qa init --profile NAME --ref SHA [--apply] | qa check (--staged | --base REF [--head REF]) [--pr JSON] [--json] | qa doctor",
    );
} catch (error) {
  console.error(`QA unavailable: ${error.message}`);
  process.exitCode = 2;
}
