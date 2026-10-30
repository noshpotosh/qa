import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function baselineStatus(sourceRoot = root) {
  const missing = [];
  for (const input of read(".qa-tracker.json").requiredInputs) {
    const file = path.join(sourceRoot, input.path);
    if (!fs.existsSync(file) || sha(file) !== input.sha256) missing.push(input.path);
  }
  return { ready: !missing.length, mismatches: missing };
}
function settings() {
  const config = read(".qa-tracker.json"), url = new URL(config.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) throw Error("Tracker must be an explicit local HTTP endpoint");
  return config;
}
async function getTracker(config, transport) {
  const response = await transport(config.url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Tracker read unavailable: ${response.status}`);
  return response.json();
}
function locate(data, binding) {
  const card = data.items.find((item) => item.id === binding.card);
  const check = card?.checks[binding.phase]?.find((item) => item.label === binding.label);
  if (!card || !check || card.milestoneId !== "grinds-slides") throw Error("Frozen acceptance scope changed; reconcile the adapter before continuing");
  return { card, check };
}
function normalized(data, config) {
  const plan = read(".qa-work.json").milestones.find((m) => m.id === "grinds-slides");
  const milestone = structuredClone(plan);
  const cards = data.items.filter((item) => item.milestoneId === milestone.id);
  const count = cards.reduce((sum, card) => sum + Object.values(card.checks).reduce((n, checks) => n + checks.length, 0), 0);
  if (count !== config.bindings.length) throw Error("Acceptance denominator changed; renewed scope review required");
  for (const criterion of milestone.criteria) {
    const binding = config.bindings.find((item) => item.id === criterion.id);
    const { card, check } = locate(data, binding);
    criterion.done = check.done;
    criterion.evidence = card.evidence ? [card.evidence] : [];
  }
  return { version: 1, revision: String(data.revision), milestone,
    context: { baseline: baselineStatus(), qualifications: "Historical check marks are not proof for a different source/build. Native capture and hands-on acceptance retain their original scope.",
      cards: cards.map(({ id, remaining, research, blockers, feedback, evidence }) => ({ id, remaining, research, blockers, feedback, evidence })) } };
}
function mirrorAcceptance(workspace, config, ids) {
  const owned = fs.realpathSync(workspace), parent = fs.realpathSync(root);
  if (!owned.startsWith(path.join(parent, ".qa-worktrees") + path.sep)) throw Error("Acceptance output must be in the runner-owned workspace");
  const file = path.join(owned, "Tracker/qa-acceptance.json");
  if (fs.realpathSync(path.dirname(file)) !== path.dirname(file) || !fs.lstatSync(file).isFile()) throw Error("Acceptance output must be a regular file in the owned workspace");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.accepted) || value.accepted.some((id) => !config.bindings.some((b) => b.id === id))) throw Error("Invalid seed acceptance data");
  const next = [...new Set([...value.accepted, ...ids])].sort();
  if (JSON.stringify(next) !== JSON.stringify(value.accepted)) {
    const temporary = `${file}.${crypto.randomUUID()}.pending`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, accepted: next }, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temporary, file);
  }
  return ["Tracker/qa-acceptance.json"];
}
export async function handle(request, transport = fetch) {
  if (request.version !== 1 || request.milestoneId !== "grinds-slides") throw Error("Unsupported tracker adapter request");
  const config = settings();
  if (request.operation === "read") return normalized(await getTracker(config, transport), config);
  if (!["record", "attest"].includes(request.operation) || !/^[a-zA-Z0-9-]{1,100}$/.test(request.operationId)) throw Error("Invalid adapter operation");
  const ids = request.operation === "attest" ? [request.criterionId] : request.receipt?.review?.resolvedSources;
  if (!Array.isArray(ids) || ids.some((id) => !config.bindings.some((b) => b.id === id))) throw Error("Unrecognized acceptance IDs");
  if (request.operation === "record" && (request.receipt?.review?.report.status !== "passed" || request.receipt.review.scope !== "within-request" || ids.some((id) => !request.task.criteria.includes(id)))) throw Error("Automatic acceptance requires a scoped passing review");
  for (const id of ids) {
    const criterion = read(".qa-work.json").milestones[0].criteria.find((c) => c.id === id);
    if ((criterion.kind === "human") !== (request.operation === "attest")) throw Error("Human and automated acceptance are separate");
  }
  if (request.operation === "attest" && request.receipt.kind !== "human-attested") throw Error("Explicit operator attestation required");
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getTracker(config, transport);
    normalized(current, config); // Validate frozen labels before any write.
    const marker = `qa-operation:${request.operationId}`;
    const targeted = request.operation === "attest" ? ids : request.task.criteria;
    const cards = new Set(targeted.map((id) => config.bindings.find((b) => b.id === id)?.card));
    if ([...cards].some((card) => !card)) throw Error("Task references an unrecognized card");
    if ([...cards].every((id) => (current.items.find((c) => c.id === id).evidence || "").includes(marker))) {
      return { version: 1, revision: String(current.revision), checkpointFiles: mirrorAcceptance(request.workspace, config, ids) };
    }
    const next = structuredClone(current);
    for (const id of ids) locate(next, config.bindings.find((b) => b.id === id)).check.done = true;
    for (const id of cards) {
      const card = next.items.find((c) => c.id === id);
      if (!(card.evidence || "").includes(marker)) card.evidence = `${card.evidence || ""}\n${marker} source:${request.sourceHead || request.receipt.sourceHead} receipt:${request.receipt.id || request.receipt.evidence}`.trim();
    }
    const response = await transport(config.url, { method: "PUT", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "If-Match": String(current.revision) }, body: JSON.stringify(next) });
    if (response.status === 409) continue;
    if (!response.ok) throw Error(`Tracker save failed: ${response.status}`);
    const saved = await response.json();
    return { version: 1, revision: String(saved.revision), checkpointFiles: mirrorAcceptance(request.workspace, config, ids) };
  }
  throw Error("Tracker kept changing; no stale write was forced");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--check-baseline") {
      const status = baselineStatus(process.argv[3] || root); console.log(JSON.stringify(status)); process.exitCode = status.ready ? 0 : 2;
    } else {
      let input = "";
      for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw Error("Adapter request too large"); }
      console.log(JSON.stringify(await handle(JSON.parse(input))));
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
