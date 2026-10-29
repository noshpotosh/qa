import fs from "node:fs";
import path from "node:path";
import { validateWorkPlan, validateBindings } from "../lib/work-plan.mjs";
import { runProcess } from "./work-process.mjs";

export async function diagnoseMilestones(root, config, probe = runProcess) {
  const result = { enabled: config.enabled, plan: { status: "not-checked" },
    executor: { status: "unavailable" }, authentication: { status: "not-checked" },
    validation: { status: "not-executed", checks: Object.keys(config.checks) },
    sandbox: { status: "not-checked", reason: "A run probes actual isolation before editing; no unrestricted fallback." },
    acceptance: { status: "not-checked", reason: "Configuration does not prove milestone completion." } };
  try {
    if (config.adapter) result.plan = { status: "configured", reason: "Custom adapter is trusted code; not invoked by doctor." };
    else {
      const plan = validateWorkPlan(JSON.parse(fs.readFileSync(path.join(root, config.plan), "utf8")));
      plan.milestones.forEach((milestone) => validateBindings(milestone, config));
      result.plan = { status: "passed", milestones: plan.milestones.map((m) => m.id) };
    }
  } catch (error) { result.plan = { status: "unavailable", reason: error.message }; }
  const help = await probe([config.codex, "exec", "--help"], { timeoutMs: 10000 });
  result.executor = { status: help.status === "passed" && help.output.includes("--ignore-user-config") && help.output.includes("--output-schema") ? "passed" : "unavailable" };
  if (result.executor.status === "passed") {
    const auth = await probe([config.codex, "login", "status"], { timeoutMs: 10000 });
    result.authentication = { status: auth.status === "passed" ? "configured" : "unavailable", reason: "CLI login status only; no live provider request." };
  }
  return result;
}
