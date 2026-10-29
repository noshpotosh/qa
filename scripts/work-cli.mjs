import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { inspectRepository } from "../lib/install.mjs";
import { selectReady } from "../lib/work-plan.mjs";
import { readMilestone } from "./work-source.mjs";
import { loadRun } from "./work-store.mjs";
import { effectiveMilestone, handoff } from "../lib/work-state.mjs";
import { runMilestone } from "./work-runner.mjs";
import { acceptCriterion } from "./work-operator.mjs";
import { publishMilestone } from "./work-publish.mjs";

export async function workCli(positionals, values) {
  const root = inspectRepository(process.cwd()).root;
  const config = loadConfig(values.config || path.join(root, ".qa.json")).work;
  const [operation, id] = positionals;
  if (["run", "resume"].includes(operation)) {
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      const result = await runMilestone(root, config, id, { approve: !!values.approve, resume: operation === "resume", retryUnavailable: !!values["retry-unavailable"], signal: abort.signal,
        onProgress: (event) => console.error(`${event.phase}: ${event.task}`) });
      if ((config.publication === "run-end" && !["budget-paused", "interrupted"].includes(result.status)) || (config.publication === "milestone-end" && result.status === "completed")) {
        try { result.publication = publishMilestone(root, id); }
        catch (e) { result.publication = { status: "unavailable", reason: e.message }; }
      }
      return result;
    } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
  if (operation === "accept") {
    if (!values.criterion || !values.evidence) throw Error("accept requires --criterion ID --evidence PATH");
    return acceptCriterion(root, config, id, values.criterion, values.evidence);
  }
  if (operation === "publish") return publishMilestone(root, id);
  if (operation === "status") {
    const { state } = loadRun(root, id);
    const snapshot = readMilestone(root, config, id);
    return handoff(state, effectiveMilestone(state, snapshot), state.available || []);
  }
  if (operation !== "plan") throw Error("Available milestone commands: plan ID | status ID");
  const snapshot = readMilestone(root, config, id);
  const ready = selectReady(snapshot.milestone, snapshot.milestone.tasks, {}, Object.keys(config.capabilities));
  return { version: 1, operation, enabled: config.enabled, milestone: snapshot.milestone,
    ready: ready.map((t) => t.id), note: "Preview only; capability availability and execution require a run." };
}
