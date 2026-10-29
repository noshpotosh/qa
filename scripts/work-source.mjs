import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateWorkPlan, validateMilestone, identifier } from "../lib/work-plan.mjs";
import { safePath } from "../lib/install.mjs";

export function invokeAdapter(root, config, request) {
  const { argv, timeoutSeconds } = config.adapter;
  const output = execFileSync(argv[0], argv.slice(1), {
    cwd: root, encoding: "utf8", input: JSON.stringify({ version: 1, ...request }),
    timeout: timeoutSeconds * 1000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  return JSON.parse(output);
}
export function readMilestone(root, config, id) {
  identifier(id);
  if (config.adapter) {
    const result = invokeAdapter(root, config, { operation: "read", milestoneId: id });
    if (result.version !== 1 || typeof result.revision !== "string") throw Error("Invalid adapter read result");
    return { ...result, milestone: validateMilestone(result.milestone) };
  }
  const file = safePath(root, config.plan);
  const plan = validateWorkPlan(JSON.parse(fs.readFileSync(file, "utf8")));
  const milestone = plan.milestones.find((m) => m.id === id);
  if (!milestone) throw Error(`Unknown milestone: ${id}`);
  return { version: 1, revision: fs.readFileSync(file, "utf8"), milestone };
}
export function previewMilestone(root, config, id) {
  const snapshot = readMilestone(root, config, id);
  return { ...snapshot, root: path.resolve(root) };
}
