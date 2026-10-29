import { fields, identifier, relativePath } from "./work-plan.mjs";

export function resolveWork(raw = {}) {
  fields(raw, ["enabled", "plan", "adapter", "minutes", "tasks", "attempts", "codex", "model", "checks", "capabilities", "resources", "publication"], "work configuration");
  const c = {
    enabled: false, plan: ".qa-work.json", adapter: null, minutes: 120, tasks: 10,
    attempts: 3, codex: "codex", model: null, checks: {}, capabilities: {},
    resources: [], publication: "manual", ...raw,
  };
  relativePath(c.plan);
  if (typeof c.enabled !== "boolean" || typeof c.codex !== "string" || !c.codex ||
      !(c.model === null || typeof c.model === "string") || !["manual", "run-end", "milestone-end"].includes(c.publication)) throw Error("Invalid work settings");
  for (const key of ["minutes", "tasks", "attempts"]) if (!Number.isSafeInteger(c[key]) || c[key] < 1 || c[key] > (key === "attempts" ? 3 : 10000)) throw Error(`Invalid work.${key}`);
  for (const key of ["checks", "capabilities"]) {
    fields(c[key], Object.keys(c[key]), key);
    for (const [id, command] of Object.entries(c[key])) {
      identifier(id); validateCommand(command);
    }
  }
  if (c.adapter !== null) validateCommand(c.adapter);
  if (!Array.isArray(c.resources)) throw Error("Resources must be an array");
  const seen = new Set();
  for (const resource of c.resources) {
    fields(resource, ["id", "source", "target"], "read-only resource");
    identifier(resource.id);
    if (seen.has(resource.id) || typeof resource.source !== "string" || !resource.source) throw Error("Invalid/duplicate resource");
    seen.add(resource.id); relativePath(resource.target);
    if (resource.target.split("/").some((p) => /^\.git|^\.qa|^\.codex/i.test(p))) throw Error("Resource targets cannot replace control files");
  }
  return c;
}
export function validateCommand(command) {
  fields(command, ["argv", "timeoutSeconds", "network", "outputs"], "command");
  if (!Array.isArray(command.argv) || !command.argv.length || command.argv.some((v) => typeof v !== "string" || !v || v.includes("\0"))) throw Error("Commands require a literal argv array");
  if (!Number.isSafeInteger(command.timeoutSeconds) || command.timeoutSeconds < 1 || command.timeoutSeconds > 3600) throw Error("Command timeout must be 1–3600 seconds");
  if (command.network !== undefined && typeof command.network !== "boolean") throw Error("Invalid network permission");
  if (command.outputs !== undefined) {
    if (!Array.isArray(command.outputs)) throw Error("Invalid command outputs");
    command.outputs.forEach(relativePath);
  }
}
