import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { inspectRepository } from "../lib/install.mjs";
import { selectReady } from "../lib/work-plan.mjs";
import { readMilestone } from "./work-source.mjs";
import { loadRun } from "./work-store.mjs";
import { effectiveMilestone, handoff } from "../lib/work-state.mjs";

export async function workCli(positionals, values) {
  const root = inspectRepository(process.cwd()).root;
  const config = loadConfig(values.config || path.join(root, ".qa.json")).work;
  const [operation, id] = positionals;
  if (operation === "status") {
    const { state } = loadRun(root, id);
    const snapshot = readMilestone(root, config, id);
    return handoff(state, effectiveMilestone(state, snapshot), Object.keys(config.capabilities));
  }
  if (operation !== "plan") throw Error("Available milestone commands: plan ID | status ID");
  const snapshot = readMilestone(root, config, id);
  const ready = selectReady(snapshot.milestone, snapshot.milestone.tasks, {}, Object.keys(config.capabilities));
  return { version: 1, operation, enabled: config.enabled, milestone: snapshot.milestone,
    ready: ready.map((t) => t.id), note: "Preview only; capability availability and execution require a run." };
}
