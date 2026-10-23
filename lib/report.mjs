import { skills } from "./config.mjs";
export const statuses = ["passed", "failed", "skipped", "unavailable"];
export const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "coverage", "findings"],
  properties: {
    status: { type: "string", enum: statuses },
    summary: { type: "string" },
    coverage: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "ruleId",
          "skill",
          "severity",
          "location",
          "evidence",
          "fix",
        ],
        properties: {
          ruleId: { type: "string" },
          skill: { type: "string", enum: skills },
          severity: { type: "string", enum: ["blocking", "suggestion"] },
          location: { type: "string" },
          evidence: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};
export function validateReport(r) {
  if (
    !r ||
    typeof r !== "object" ||
    Array.isArray(r) ||
    Object.keys(r).some(
      (k) => !["status", "summary", "coverage", "findings"].includes(k),
    )
  )
    throw Error("Invalid report object");
  if (
    !statuses.includes(r.status) ||
    typeof r.summary !== "string" ||
    !r.summary.trim() ||
    !Array.isArray(r.coverage) ||
    r.coverage.some((s) => typeof s !== "string") ||
    !Array.isArray(r.findings)
  )
    throw Error("Invalid report fields");
  if (r.findings.length > 100) throw Error("Too many findings");
  for (const f of r.findings) {
    if (
      !f ||
      typeof f !== "object" ||
      Object.keys(f).length !== 6 ||
      !["ruleId", "skill", "severity", "location", "evidence", "fix"].every(
        (k) => typeof f[k] === "string" && f[k].trim(),
      )
    )
      throw Error("Invalid finding");
    if (
      !skills.includes(f.skill) ||
      !["blocking", "suggestion"].includes(f.severity)
    )
      throw Error("Invalid finding classification");
  }
  const blocking = r.findings.some((f) => f.severity === "blocking");
  if (
    (r.status === "passed" && blocking) ||
    (r.status === "failed" && !blocking)
  )
    throw Error("Inconsistent report status");
  return r;
}
export function unavailable(reason) {
  return {
    status: "unavailable",
    summary: reason,
    coverage: ["Agent review was not completed."],
    findings: [],
  };
}
function escape(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "＠");
}
export function renderReport(
  r,
  { title = "QA review", advisory = false } = {},
) {
  validateReport(r);
  const lines = [
    `## ${title}`,
    `Status: **${r.status}**${advisory ? " (agent findings are advisory)" : ""}`,
    "",
    escape(r.summary),
  ];
  for (const skill of skills) {
    const fs = r.findings.filter((f) => f.skill === skill);
    if (!fs.length) continue;
    lines.push("", `### ${skill}`);
    for (const f of fs)
      lines.push(
        "",
        `- **${f.severity} · ${escape(f.ruleId)}** — ${escape(f.location)}`,
        `  ${escape(f.evidence)}`,
        `  Fix: ${escape(f.fix)}`,
      );
  }
  if (r.coverage.length)
    lines.push(
      "",
      "### Coverage and limitations",
      ...r.coverage.map((s) => `- ${escape(s)}`),
    );
  return lines.join("\n") + "\n";
}
