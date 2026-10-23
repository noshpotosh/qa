import { matches, selectSkills } from "./config.mjs";
export function section(body, name) {
  const clean = (body || "").replace(/<!--[\s\S]*?-->/g, "");
  const lines = clean.split("\n");
  let active = false,
    out = [];
  for (const l of lines) {
    const m = l.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m) {
      if (active) break;
      active = m[1].toLowerCase() === name.toLowerCase();
    } else if (active) out.push(l);
  }
  return out
    .join("\n")
    .replace(/^[\s\-*\[\]0-9.)]+$/gm, "")
    .trim();
}
export function classify(file, c) {
  if (file.binary) return "binary";
  for (const group of ["vendor", "generated", "captures"])
    if (c.paths[group].some((p) => matches(file.path, p))) return group;
  return "authored";
}
export function checkPolicy(context, config, pr) {
  const findings = [];
  const add = (ruleId, severity, location, evidence, fix) =>
    findings.push({
      ruleId,
      skill: "delivery-steward",
      severity,
      location,
      evidence,
      fix,
    });
  const buckets = {};
  for (const f of context.files) {
    const k = classify(f, config);
    buckets[k] ??= { files: 0, lines: 0 };
    buckets[k].files++;
    buckets[k].lines += f.added + f.deleted;
  }
  const authored = buckets.authored || { files: 0, lines: 0 };
  if (
    authored.lines > config.thresholds.warnLines ||
    authored.files > config.thresholds.warnFiles
  )
    add(
      "DEL-SIZE",
      "suggestion",
      "diff",
      `${authored.lines} authored changed lines across ${authored.files} files.`,
      `Prefer one coherent concern; warn thresholds are ${config.thresholds.warnLines} lines / ${config.thresholds.warnFiles} files.`,
    );
  if (pr) {
    if (
      typeof pr.title !== "string" ||
      typeof pr.body !== "string" ||
      typeof pr.base !== "string"
    )
      throw Error("PR metadata requires title, body and base strings");
    const title = pr.title.trim();
    if (
      title.length < 10 ||
      /^(?:updates?|fix(?:es)?(?: stuff)?|added v\d+|wip|changes?)[.! ]*$/i.test(
        title,
      )
    )
      add(
        "DEL-TITLE",
        "blocking",
        "PR title",
        "Title is missing, too short or a known placeholder.",
        "Describe the affected area and resulting behavior.",
      );
    if (pr.base !== config.integrationBranch)
      add(
        "DEL-BASE",
        "blocking",
        "PR base",
        `Targets ${pr.base}; configured integration branch is ${config.integrationBranch}.`,
        "Retarget the PR or resolve the repository configuration conflict.",
      );
    for (const name of ["Problem", "Behavior", "Validation", "Risks"])
      if (section(pr.body, config.sections[name]).length < 10)
        add(
          "DEL-DESCRIPTION",
          "blocking",
          `PR / ${name}`,
          `Missing substantive ${name} section.`,
          "Use a sentence describing the change; explicitly state checks not run or risks not identified.",
        );
    if (
      authored.lines > config.thresholds.exceptionLines &&
      section(pr.body, config.sections.size).length < 20
    )
      add(
        "DEL-EXCEPTION",
        "blocking",
        "PR / Size exception",
        `More than ${config.thresholds.exceptionLines} authored lines without an explanation.`,
        "Add a split plan or explain why the change is inseparable.",
      );
    const ui = context.files.some(
      (f) =>
        classify(f, config) === "authored" &&
        config.paths.ui.some((p) => matches(f.path, p)),
    );
    if (ui && config.requireVisualEvidence) {
      const visual = section(pr.body, config.sections.visual);
      if (
        !/https?:\/\/\S+/.test(visual) &&
        !/^unavailable:\s*\S[\s\S]{19,}/i.test(visual)
      )
        add(
          "DEL-VISUAL",
          "blocking",
          "PR / Visual evidence",
          "UI changes lack an evidence reference or explicit gap.",
          "Provide a screenshot/clip URL or “Unavailable: <specific explanation>”.",
        );
    }
  }
  return {
    report: {
      status: findings.some((f) => f.severity === "blocking")
        ? "failed"
        : "passed",
      summary: `Mechanical checks: ${authored.lines} authored changed lines in ${authored.files} files.`,
      coverage: [
        ...context.coverage,
        ...(!pr
          ? [
              "PR metadata not provided; title, target and evidence-field checks skipped.",
            ]
          : []),
        "Evidence-field checks validate structure, not truth. Validation commands were not executed.",
      ],
      findings,
    },
    buckets,
    selectedSkills: selectSkills(
      config,
      context.files.map((f) => f.path),
      { audit: context.mode === "audit" },
    ),
  };
}
