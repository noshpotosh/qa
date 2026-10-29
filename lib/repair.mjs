import crypto from "node:crypto";
import { validateReport, reportSchema } from "./report.mjs";

export const repairMarker = "<!-- noshpotosh-qa:repair:v1 -->";
export const maxRounds = 3;
export const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const changeSchema = {
  type: "object", additionalProperties: false, required: ["changes"],
  properties: { changes: { type: "array", maxItems: 50, items: {
    type: "object", additionalProperties: false, required: ["path", "content"],
    properties: { path: { type: "string" }, content: { type: ["string", "null"] } },
  } } },
};
export const reviewSchema = {
  type: "object", additionalProperties: false, required: ["report", "resolvedSources", "scope"],
  properties: { report: reportSchema, resolvedSources: { type: "array", items: { type: "string" } }, scope: { type: "string", enum: ["within-request", "expanded", "conflicting"] } },
};
export function validateChanges(candidate, tree) {
  if (!candidate || Object.keys(candidate).join() !== "changes" || !Array.isArray(candidate.changes) || candidate.changes.length > 50) throw Error("Invalid change bundle");
  if (Buffer.byteLength(JSON.stringify(candidate)) > 1024 * 1024) throw Error("Change bundle exceeds 1 MiB");
  const seen = new Set();
  for (const change of candidate.changes) {
    if (!change || Object.keys(change).sort().join() !== "content,path" || typeof change.path !== "string" || !(change.content === null || typeof change.content === "string")) throw Error("Invalid file replacement");
    const name = change.path, parts = name.split("/");
    if (!name || /[\\\x00-\x1f\x7f]/.test(name) || parts.some((p) => !p || p === "." || p === "..") || name.normalize("NFC") !== name) throw Error("Unsafe change path");
    if (parts.some((p) => /^(?:\.git.*|\.qa(?:\..*)?|\.github|\.agents|\.codex|\.claude|agents\.md|claude\.md)$/i.test(p))) throw Error(`Control configuration requires manual handling: ${name}`);
    if (seen.has(name.toLowerCase())) throw Error("Duplicate or case-colliding path");
    seen.add(name.toLowerCase());
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const entry = tree.find((e) => e.path.toLowerCase() === prefix.toLowerCase());
      if (entry && (entry.path !== prefix || (i < parts.length ? entry.type !== "tree" : entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)))) throw Error(`Unsafe source entry: ${name}`);
    }
    if (change.content?.includes("\0")) throw Error("Binary changes require manual handling");
    if (change.content === null && !tree.some((e) => e.path === name)) throw Error("Cannot delete absent file");
  }
  return candidate;
}
export function validateRecord(record) {
  if (record?.version !== 1 || !/^[0-9]+$/.test(record.runId) || !["issue", "pr"].includes(record.target?.kind) || !Number.isSafeInteger(record.target.number) || record.target.number < 1 || !/^[0-9a-f]{40}$/.test(record.currentHead) || !/^[0-9a-f]{40}$/.test(record.target.baseSha) || !Array.isArray(record.rounds) || record.rounds.length > maxRounds || !Array.isArray(record.sources) || !record.sources.length) throw Error("Invalid repair record");
  return record;
}
export function parseReview(text, sources) {
  const value = JSON.parse(text);
  if (Object.keys(value).sort().join() !== "report,resolvedSources,scope" || !["within-request", "expanded", "conflicting"].includes(value.scope) || !Array.isArray(value.resolvedSources) || new Set(value.resolvedSources).size !== value.resolvedSources.length || value.resolvedSources.some((id) => !sources.some((s) => s.id === id))) throw Error("Invalid repair review");
  validateReport(value.report);
  return value;
}
export function repairBody(record) {
  validateRecord(record);
  return `${repairMarker}\nRequest: ${record.runId}\n\nStatus: **${record.status}**\n\n${record.reason || "Repair requested; human merge required."}\n\n` + record.rounds.map((r) => `- Round ${r.number}: ${r.status}; commit ${r.commit || "unpublished"}; validation ${r.validation?.status || "unavailable"}; policy ${r.validation?.policy?.status || "unavailable"}; review ${r.review?.report?.status || "unavailable"}.`).join("\n") + `\n\nResolved sources: ${(record.resolvedSources || []).join(", ") || "none verified"}. Full evidence: workflow artifacts.\n`;
}
