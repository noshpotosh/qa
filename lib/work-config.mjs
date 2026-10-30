import { fields, identifier, relativePath } from "./work-plan.mjs";

export function resolveWork(raw = {}) {
  fields(raw, ["enabled", "plan", "adapter", "minutes", "tasks", "attempts", "codex", "model", "checks", "capabilities", "resources", "publication", "protectedPaths", "adapterOutputs", "requiredCapabilities", "readRoots", "version", "operations"], "work configuration");
  if (raw.version !== undefined && raw.version !== 2) throw Error("Unsupported work version");
  if (raw.operations !== undefined && raw.version !== 2) throw Error("Operations require v2");
  const c = {
    enabled: false, plan: ".qa-work.json", adapter: null, minutes: 120, tasks: 10,
    attempts: 3, codex: "codex", model: null, checks: {}, capabilities: {},
    resources: [], publication: "manual", protectedPaths: [], adapterOutputs: [], requiredCapabilities: [], readRoots: [], ...raw,
  };
  if (c.version === 2) c.operations ||= {};
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
  for (const [id, operation] of Object.entries(c.operations || {})) {
    identifier(id);
    fields(operation, ["argv", "timeoutSeconds", "network", "outputs", "requires", "readRoots", "inputs", "verifier", "reuse"], "operation");
    const { inputs, verifier, reuse = "fresh", ...command } = operation;
    validateCommand(command);
    if (!Array.isArray(inputs) || !inputs.length || !operation.outputs?.length || !Object.hasOwn(c.checks, verifier) || !["fresh", "inputs"].includes(reuse)) throw Error("Operations require inputs, outputs, a verifier and valid reuse policy");
    inputs.forEach(relativePath);
    if (operation.outputs.some((p) => !p.startsWith(".qa-output/"))) throw Error("Operation outputs must be under .qa-output");
    if (inputs.some((p) => p.startsWith(".qa-output/"))) throw Error("Operation inputs must be durable source files");
  }
  if (c.version === 2 && Object.values(c.capabilities).some((command) => command.probe !== true)) throw Error("V2 capabilities must explicitly declare non-destructive probe: true");
  for (const key of ["protectedPaths", "adapterOutputs"]) {
    if (!Array.isArray(c[key])) throw Error(`Invalid work.${key}`);
    c[key].forEach((value) => { relativePath(value); if (/[?*]/.test(value)) throw Error("Control output paths must be literal"); });
  }
  for (const file of c.adapterOutputs) {
    if (file === c.plan || /(^|\/)(?:\.(?:git|qa|codex|agents)[^/]*|AGENTS\.md|CLAUDE\.md)(\/|$)/i.test(file) || file === "package.json") throw Error("Adapter outputs cannot replace execution authority");
  }
  for (const command of [...Object.values(c.checks), ...Object.values(c.capabilities), ...Object.values(c.operations || {})]) {
    if ((command.requires || []).some((id) => !Object.hasOwn(c.capabilities, id))) throw Error("Unknown command capability");
  }
  if (!Array.isArray(c.readRoots) || c.readRoots.some((p) => typeof p !== "string" || !p || p.includes("\0"))) throw Error("readRoots must contain explicit paths");
  if (!Array.isArray(c.requiredCapabilities) || c.requiredCapabilities.some((id) => !Object.hasOwn(c.capabilities, identifier(id)))) throw Error("Invalid requiredCapabilities");
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
  fields(command, ["argv", "timeoutSeconds", "network", "outputs", "requires", "readRoots", "probe"], "command");
  if (command.probe !== undefined && command.probe !== true) throw Error("Invalid probe declaration");
  if (!Array.isArray(command.argv) || !command.argv.length || command.argv.some((v) => typeof v !== "string" || !v || v.includes("\0"))) throw Error("Commands require a literal argv array");
  if (!Number.isSafeInteger(command.timeoutSeconds) || command.timeoutSeconds < 1 || command.timeoutSeconds > 3600) throw Error("Command timeout must be 1–3600 seconds");
  if (command.network !== undefined && typeof command.network !== "boolean") throw Error("Invalid network permission");
  if (command.requires !== undefined) {
    if (!Array.isArray(command.requires)) throw Error("Invalid required command capabilities");
    command.requires.forEach(identifier);
  }
  if (command.readRoots !== undefined && (!Array.isArray(command.readRoots) || command.readRoots.some((p) => typeof p !== "string" || !p))) throw Error("Invalid command read roots");
  if (command.outputs !== undefined) {
    if (!Array.isArray(command.outputs)) throw Error("Invalid command outputs");
    command.outputs.forEach(relativePath);
  }
}
